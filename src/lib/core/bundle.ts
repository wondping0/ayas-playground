import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { AppError } from './errors'
import { DEFAULT_FLAG_FORMAT, isValidFlagFormat } from './flag-format'
import { LICENSE_TYPES } from './license'
import { hasFile, type BundleManifest } from './manifest'
import { isSafeBundlePath } from './safe-path'

/**
 * The bundle contract — a superset of CTFd `ctfcli`'s `challenge.yml`.
 *
 * Unknown top-level fields are carried through untouched, so a bundle stays
 * loadable by tools that have never heard of this marketplace and a round trip
 * does not lose data. See decisions/0006-ctfd-compatible-bundle.
 */

export const FLAG_MODES = ['static', 'substitute', 'generate'] as const
export type FlagMode = (typeof FLAG_MODES)[number]

export const SANDBOX_PROFILES = ['python-crypto', 'sage'] as const
export type SandboxProfile = (typeof SANDBOX_PROFILES)[number]

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'insane'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

/** v1 sells cryptography only. The taxonomy is data; this gate is deliberate. */
export const ENABLED_CATEGORIES = ['crypto'] as const

export const DEFAULT_GENERATOR = 'server_files/generate.py'
export const DEFAULT_SOLVER = 'solver/solve.py'
export const WRITEUP_PATH = 'writeup.md'
export const CHALLENGE_YAML = 'challenge.yml'
export const RELEASE_DIR = 'release_files'
export const SERVER_DIR = 'server_files'

const MIN_SOLVER_TIMEOUT_MS = 1_000
const MAX_SOLVER_TIMEOUT_MS = 300_000

const bundlePath = z
  .string()
  .min(1)
  .max(200)
  .refine(isSafeBundlePath, { message: 'is not a safe relative path' })

const flagSpecSchema = z
  .object({
    mode: z.enum(FLAG_MODES),
    format: z
      .string()
      .default(DEFAULT_FLAG_FORMAT)
      .refine(isValidFlagFormat, {
        message: 'must contain exactly one "%s" and use only [A-Za-z0-9_-{}[]().:]',
      }),
    /** `generate` mode: the script run with $FLAG to rebuild release files. */
    generator: bundlePath.optional(),
    /** `substitute` mode: files in which `{{FLAG}}` is replaced. */
    substituteIn: z.array(bundlePath).max(64).optional(),
  })
  .strict()

const solverSpecSchema = z
  .object({
    entrypoint: bundlePath.default(DEFAULT_SOLVER),
    profile: z.enum(SANDBOX_PROFILES).default('python-crypto'),
    timeoutMs: z
      .number()
      .int()
      .min(MIN_SOLVER_TIMEOUT_MS)
      .max(MAX_SOLVER_TIMEOUT_MS)
      .default(60_000),
  })
  .strict()

const ayaSchema = z
  .object({
    scheme: z
      .union([z.string(), z.array(z.string()).min(1).max(3)])
      .transform((v) => (Array.isArray(v) ? v : [v])),
    difficulty: z.enum(DIFFICULTIES),
    flag: flagSpecSchema,
    solver: solverSpecSchema.default({}),
    license: z.enum(LICENSE_TYPES).default('event'),
  })
  .strict()

const hintSchema = z.union([
  z.string(),
  z.object({ content: z.string(), cost: z.number().int().min(0).optional() }).passthrough(),
])

export const challengeYamlSchema = z
  .object({
    name: z.string().min(1).max(120),
    author: z.string().min(1).max(120),
    category: z.string().min(1).max(40),
    description: z.string().min(1).max(8_000),
    attribution: z.string().max(200).optional(),
    value: z.number().int().min(0).max(100_000).optional(),
    type: z.string().max(40).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    topics: z.array(z.string().max(40)).max(20).optional(),
    hints: z.array(hintSchema).max(20).optional(),
    files: z.array(bundlePath).max(64).optional(),
    connection_info: z.string().max(200).optional(),
    state: z.string().max(20).optional(),
    version: z.string().max(20).optional(),

    /**
     * ctfcli's literal flags. Accepted only in `static` mode — see
     * assertFlagNotLiteral below.
     */
    flags: z.array(z.unknown()).max(20).optional(),

    aya: ayaSchema,
  })
  .passthrough()

export type ChallengeSpec = z.infer<typeof challengeYamlSchema>

/**
 * Parse `challenge.yml`.
 *
 * `maxAliasCount` caps YAML alias expansion: without it, a few lines of
 * anchors expand to gigabytes during parsing, which is a denial of service that
 * lands before any of the size checks on extracted files.
 */
export function parseChallengeYaml(text: string): ChallengeSpec {
  if (text.length > 256 * 1024) {
    throw new AppError('bundle_invalid', 'challenge.yml is larger than 256 KiB.')
  }

  let raw: unknown
  try {
    raw = parseYaml(text, { maxAliasCount: 100, prettyErrors: false })
  } catch (cause) {
    throw new AppError('bundle_invalid', 'challenge.yml is not valid YAML.', { cause })
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('bundle_invalid', 'challenge.yml must be a YAML mapping.')
  }

  const result = challengeYamlSchema.safeParse(raw)
  if (!result.success) {
    throw new AppError('bundle_invalid', 'challenge.yml failed validation.', {
      details: {
        issues: result.error.issues.slice(0, 20).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    })
  }

  assertFlagNotLiteral(result.data)
  return result.data
}

/**
 * The single most common authoring mistake: leaving a real flag in the file
 * while declaring a dynamic mode. Caught at parse time, before a sandbox is
 * ever started, because in `generate` mode that literal is silently ignored and
 * every buyer would receive a challenge whose stated flag is not its real one.
 */
export function assertFlagNotLiteral(spec: ChallengeSpec): void {
  if (spec.aya.flag.mode === 'static') return
  if (spec.flags !== undefined && spec.flags.length > 0) {
    throw new AppError(
      'bundle_invalid',
      `A literal "flags:" entry is only allowed with flag mode "static". ` +
        `In "${spec.aya.flag.mode}" mode the flag is generated per buyer, so a literal here would be ignored — remove it.`,
    )
  }
}

export interface StructureIssue {
  path: string
  message: string
}

/**
 * Cross-check the spec against what is actually in the bundle.
 *
 * Scheme ids are *not* validated here: the taxonomy lives in the catalog plane,
 * and `core` does not depend on a plane. The catalog validates them on submit.
 */
export function validateBundleStructure(
  spec: ChallengeSpec,
  manifest: BundleManifest,
): StructureIssue[] {
  const issues: StructureIssue[] = []
  const require = (path: string, message: string) => {
    if (!hasFile(manifest, path)) issues.push({ path, message })
  }

  require(CHALLENGE_YAML, 'Every bundle needs a challenge.yml at its root.')
  require(WRITEUP_PATH, 'A writeup.md is required — it is most of what the buyer pays for.')

  const releaseFiles = manifest.files.filter((f) => f.path.startsWith(`${RELEASE_DIR}/`))
  if (releaseFiles.length === 0) {
    issues.push({
      path: `${RELEASE_DIR}/`,
      message: 'A bundle needs at least one release file — the handout players receive.',
    })
  }

  const solver = spec.aya.solver.entrypoint
  if (!solver.startsWith('solver/')) {
    issues.push({ path: solver, message: 'The solver entrypoint must live under solver/.' })
  }
  require(solver, 'The declared solver entrypoint does not exist in the bundle.')

  if (spec.aya.flag.mode === 'generate') {
    const generator = spec.aya.flag.generator ?? DEFAULT_GENERATOR
    if (!generator.startsWith(`${SERVER_DIR}/`)) {
      issues.push({
        path: generator,
        message: `The generator must live under ${SERVER_DIR}/ so it is never delivered to players.`,
      })
    }
    require(generator, 'Flag mode is "generate" but the generator script does not exist.')
  }

  if (spec.aya.flag.mode === 'static' && staticFlag(spec) === null) {
    issues.push({
      path: 'flags',
      message:
        'Flag mode is "static", so the bundle must declare its literal flag under "flags:". ' +
        'Without it there is nothing to verify against and nothing to tell the buyer.',
    })
  }

  if (spec.aya.flag.mode === 'substitute') {
    const targets = spec.aya.flag.substituteIn ?? []
    if (targets.length === 0) {
      issues.push({
        path: 'aya.flag.substituteIn',
        message: 'Flag mode is "substitute" but no files were listed to substitute in.',
      })
    }
    for (const target of targets) {
      require(target, 'A file listed in aya.flag.substituteIn does not exist.')
    }
  }

  for (const declared of spec.files ?? []) {
    require(declared, 'A file listed in "files:" does not exist in the bundle.')
  }

  if (!ENABLED_CATEGORIES.includes(spec.category as (typeof ENABLED_CATEGORIES)[number])) {
    issues.push({
      path: 'category',
      message: `Only ${ENABLED_CATEGORIES.join(', ')} challenges can be listed right now, got "${spec.category}".`,
    })
  }

  return issues
}

/** The generator path for a spec, defaulted. */
export function generatorPath(spec: ChallengeSpec): string {
  return spec.aya.flag.generator ?? DEFAULT_GENERATOR
}

/**
 * The literal flag of a `static` bundle, or null.
 *
 * A static bundle cannot be re-flagged, so its flag is a fixed property of the
 * challenge rather than a per-order value. Both verification and fulfilment
 * need it: verification because the solver will print *this* flag and not an
 * ephemeral one, and fulfilment because the buyer's copy must state the flag
 * the handout actually encodes.
 *
 * ctfcli allows a flag to be a bare string or an object, so both are accepted.
 */
export function staticFlag(spec: ChallengeSpec): string | null {
  if (spec.aya.flag.mode !== 'static') return null

  const first = spec.flags?.[0]
  if (typeof first === 'string' && first.length > 0) return first

  if (first !== null && typeof first === 'object') {
    const content = (first as { content?: unknown }).content
    if (typeof content === 'string' && content.length > 0) return content
  }

  return null
}

/** Whether every buyer of this bundle gets their own flag. */
export function isReflaggable(spec: ChallengeSpec): boolean {
  return spec.aya.flag.mode !== 'static'
}
