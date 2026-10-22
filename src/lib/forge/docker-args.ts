import { AppError } from '@/lib/core/errors'

/**
 * The `docker run` argument builder.
 *
 * This function IS the sandbox. Every isolation property in
 * .wondev/memory/security-guardrails.md is expressed here and asserted
 * exhaustively in docker-args.test.ts. Treat a change to either with the
 * seriousness of changing a firewall rule.
 */

export interface DockerRunOptions {
  image: string
  containerName: string
  /** Host path mounted read-only at /work. */
  workDir: string
  /** Host path mounted read-write at /out. */
  outDir: string
  command: string[]
  env: Record<string, string>
  memoryMb: number
  pidsLimit: number
  tmpfsMb: number
  /**
   * Working directory inside the container. Restricted to the two mount points
   * so it can never be a host path or an option.
   *
   * `/out` is used for the `generate` step, so an author's ordinary
   * `open('output.txt', 'w')` lands in the writable mount without them having
   * to know anything about how the sandbox is put together.
   */
  workdir?: typeof CONTAINER_WORK | typeof CONTAINER_OUT
}

export const CONTAINER_WORK = '/work'
export const CONTAINER_OUT = '/out'
/** `nobody`. Present in every image we build. */
export const CONTAINER_UID = '65534:65534'
export const RUN_LABEL = 'ayas-playground.run'

const ENV_KEY = /^[A-Z][A-Z0-9_]*$/
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/
const IMAGE_REF = /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*(:[a-zA-Z0-9._-]+)?(@sha256:[a-f0-9]{64})?$/

function reject(message: string): never {
  throw new AppError('sandbox_error', message)
}

/**
 * Anything that could be read by Docker as an option rather than a value.
 *
 * argv is passed to spawn without a shell, so quoting is not the risk — option
 * injection is. A path or image beginning with `-` becomes a flag.
 */
function assertNotOptionLike(label: string, value: string): void {
  if (value.startsWith('-')) reject(`${label} must not begin with "-": ${value}`)
}

function assertNoControlChars(label: string, value: string): void {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) reject(`${label} must not contain control characters.`)
}

export function buildDockerArgs(options: DockerRunOptions): string[] {
  const {
    image,
    containerName,
    workDir,
    outDir,
    command,
    env,
    memoryMb,
    pidsLimit,
    tmpfsMb,
    workdir = CONTAINER_WORK,
  } = options

  if (workdir !== CONTAINER_WORK && workdir !== CONTAINER_OUT) {
    reject(`workdir must be ${CONTAINER_WORK} or ${CONTAINER_OUT}, got ${workdir}`)
  }
  if (!IMAGE_REF.test(image)) reject(`Invalid image reference: ${image}`)
  if (!CONTAINER_NAME.test(containerName)) reject(`Invalid container name: ${containerName}`)
  if (command.length === 0) reject('A sandbox run needs a command.')

  for (const [label, value] of [
    ['workDir', workDir],
    ['outDir', outDir],
  ] as const) {
    if (value.length === 0) reject(`${label} must not be empty.`)
    assertNoControlChars(label, value)
    assertNotOptionLike(label, value)
    // A comma or an equals sign would be read as a `--mount` sub-option.
    if (value.includes(',') || value.includes('=')) {
      reject(`${label} must not contain a comma or an equals sign: ${value}`)
    }
  }

  for (const [index, arg] of command.entries()) {
    assertNoControlChars(`command[${index}]`, arg)
  }

  if (!Number.isInteger(memoryMb) || memoryMb < 16) reject('memoryMb must be an integer >= 16.')
  if (!Number.isInteger(pidsLimit) || pidsLimit < 1) reject('pidsLimit must be an integer >= 1.')
  if (!Number.isInteger(tmpfsMb) || tmpfsMb < 1) reject('tmpfsMb must be an integer >= 1.')

  const args: string[] = [
    'run',
    // Never leave a container behind; a run directory outlives nothing.
    '--rm',
    '--name',
    containerName,
    '--label',
    `${RUN_LABEL}=1`,

    // --- Isolation ---------------------------------------------------------
    // A crypto challenge never needs the network. This removes exfiltration,
    // pivoting, and dependency-fetch surprises in one flag.
    '--network',
    'none',
    // Nothing persists outside the declared output mount.
    '--read-only',
    // Bounded scratch space. noexec/nosuid so a dropped binary cannot be run.
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,size=${tmpfsMb}m`,
    // Never root, even inside the container.
    '--user',
    CONTAINER_UID,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',

    // --- Resource caps -----------------------------------------------------
    '--memory',
    `${memoryMb}m`,
    // Equal to --memory disables swap. Without this the container gets twice
    // the memory it was granted, and the cap means nothing.
    '--memory-swap',
    `${memoryMb}m`,
    '--cpus',
    '1',
    '--pids-limit',
    String(pidsLimit),

    // --- Filesystem --------------------------------------------------------
    '--workdir',
    workdir,
    '--mount',
    `type=bind,source=${workDir},target=${CONTAINER_WORK},readonly`,
    '--mount',
    `type=bind,source=${outDir},target=${CONTAINER_OUT}`,
  ]

  for (const key of Object.keys(env).sort()) {
    if (!ENV_KEY.test(key)) reject(`Invalid environment variable name: ${key}`)
    const value = env[key]!
    assertNoControlChars(`env.${key}`, value)
    args.push('--env', `${key}=${value}`)
  }

  args.push(image, ...command)
  return args
}

/**
 * The kill used when the wall-clock timeout fires.
 *
 * The timeout is enforced host-side. A container asked politely to stop can
 * decline; `docker kill` does not ask.
 */
export function buildDockerKillArgs(containerName: string): string[] {
  if (!CONTAINER_NAME.test(containerName)) reject(`Invalid container name: ${containerName}`)
  return ['kill', '--signal', 'KILL', containerName]
}
