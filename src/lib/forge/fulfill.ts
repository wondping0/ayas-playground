import { readFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import {
  CHALLENGE_YAML,
  RELEASE_DIR,
  SERVER_DIR,
  WRITEUP_PATH,
  staticFlag,
  type ChallengeSpec,
} from '@/lib/core/bundle'
import { hashBytes } from '@/lib/core/manifest'
import type { LicenseTerms } from '@/lib/core/license'
import { extractBundle, packBundle, type PackEntry } from './archive'
import { buildRelease, missingDeclaredReleaseFiles } from './build'
import type { SandboxRunner } from './runner'
import { withWorkspace } from './workspace'

/**
 * Turning a paid order into a deliverable.
 *
 * Same sandbox primitive as verification, different flag and different caller.
 * This runs *after* money has changed hands, which is why it is queued with
 * retry and why its failure has a dedicated order state. See
 * decisions/0003-flag-modes.
 */

export interface FulfillRequest {
  bundleData: Buffer
  spec: ChallengeSpec
  /** The buyer's derived flag. */
  flag: string
  runner: SandboxRunner
  terms: LicenseTerms
  licenseText: string
  challengeTitle: string
  runId?: string
}

export interface FulfillResult {
  ok: boolean
  artifact: Buffer | null
  sha256: string | null
  message: string
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out: string[] = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await listFiles(join(dir, entry.name), rel)))
    else if (entry.isFile()) out.push(rel)
  }
  return out.sort()
}

/**
 * The `challenge.yml` the buyer receives.
 *
 * It carries the literal flag, because the buyer is the organiser — they need
 * it to configure scoring — and the mode is rewritten to `static` because the
 * bundle they hold genuinely is fixed now. Unknown ctfcli fields are preserved,
 * so `ctf challenge push` works against their own CTFd unchanged.
 */
export function deliveredChallengeYaml(
  spec: ChallengeSpec,
  flag: string,
  releaseFiles: readonly string[],
): string {
  const { aya, ...rest } = spec
  const delivered: Record<string, unknown> = {
    ...rest,
    flags: [flag],
    files: releaseFiles.map((path) => `${RELEASE_DIR}/${path}`),
    state: 'hidden',
    aya: {
      scheme: aya.scheme,
      difficulty: aya.difficulty,
      license: aya.license,
      flag: { mode: 'static', format: aya.flag.format },
      solver: aya.solver,
    },
  }
  return stringifyYaml(delivered, { lineWidth: 100 })
}

function renderReadme(
  title: string,
  terms: LicenseTerms,
  flag: string,
  reflaggable: boolean,
): string {
  return `# ${title}

Bought from Aya's Playground. Licence: ${terms.name}.

## What is in here

    challenge.yml     ctfcli-compatible metadata, with your flag
    release_files/    the handout — give these to your players
    solver/           the author's solver, for your own reference
    writeup.md        the author's explanation of the intended solution
    LICENSE.txt       what you may and may not do with this

## Deploying it

If you run CTFd, this folder is a ctfcli challenge:

    ctf challenge install .
    ctf challenge deploy .

Otherwise: publish the contents of \`release_files/\` and set the flag to

    ${flag}

${
  reflaggable
    ? `## Your flag is yours alone

This flag was generated for your order and no other copy of this challenge has
it. Do not publish \`writeup.md\` or \`solver/\` before your event ends.`
    : `## This challenge ships a fixed flag

It cannot be re-flagged, so every buyer receives the same flag. Treat it as
already semi-public: if it has been used at an event before, players may have
seen it. Do not publish \`writeup.md\` or \`solver/\` before your event ends.`
}
`
}

export async function fulfillOrder(request: FulfillRequest): Promise<FulfillResult> {
  const { bundleData, spec, runner, terms } = request

  // A static bundle cannot be re-flagged, so the buyer's derived flag does not
  // apply to it — the handout encodes the author's literal flag, and telling
  // the buyer anything else would hand them a challenge nobody can solve.
  const flag = staticFlag(spec) ?? request.flag

  return withWorkspace(async (workspace) => {
    const bundleDir = join(workspace.workDir, 'bundle')
    const releaseDir = join(workspace.outDir, 'release')
    await mkdir(releaseDir, { recursive: true })

    await extractBundle(bundleData, bundleDir)

    const build = await buildRelease({
      bundleDir,
      targetDir: releaseDir,
      spec,
      flag,
      runner,
      runId: `${workspace.runId}f`,
    })

    if (!build.ok) {
      return {
        ok: false,
        artifact: null,
        sha256: null,
        message: `Could not build this order's copy. ${build.message}`,
      }
    }

    const missing = await missingDeclaredReleaseFiles(bundleDir, releaseDir)
    if (missing.length > 0) {
      return {
        ok: false,
        artifact: null,
        sha256: null,
        message: `The build is missing declared release files: ${missing.join(', ')}.`,
      }
    }

    const releaseFiles = await listFiles(releaseDir)
    const entries: PackEntry[] = []

    for (const path of releaseFiles) {
      entries.push({ path: `${RELEASE_DIR}/${path}`, sourcePath: join(releaseDir, path) })
    }

    // The solver and the writeup are most of what was paid for.
    for (const path of await listFiles(join(bundleDir, 'solver'))) {
      entries.push({ path: `solver/${path}`, sourcePath: join(bundleDir, 'solver', path) })
    }

    const writeup = await readFile(join(bundleDir, WRITEUP_PATH)).catch(() => null)
    if (writeup) entries.push({ path: WRITEUP_PATH, content: writeup })

    // The generator is withheld unless the licence covers repeated events —
    // holding it lets the buyer mint their own flags, which defeats the
    // per-order fingerprint that makes a leak traceable.
    if (terms.type === 'unlimited') {
      for (const path of await listFiles(join(bundleDir, SERVER_DIR))) {
        entries.push({
          path: `${SERVER_DIR}/${path}`,
          sourcePath: join(bundleDir, SERVER_DIR, path),
        })
      }
    }

    entries.push({
      path: CHALLENGE_YAML,
      content: deliveredChallengeYaml(spec, flag, releaseFiles),
    })
    entries.push({ path: 'LICENSE.txt', content: request.licenseText })
    entries.push({
      path: 'README.md',
      content: renderReadme(request.challengeTitle, terms, flag, staticFlag(spec) === null),
    })

    const artifact = await packBundle(entries)

    return {
      ok: true,
      artifact,
      sha256: hashBytes(artifact),
      message: `Packaged ${entries.length} file(s).`,
    }
  }, request.runId)
}
