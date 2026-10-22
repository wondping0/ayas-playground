import { AppError } from './errors'

/**
 * Environment access.
 *
 * Read through functions rather than a frozen object captured at import time,
 * so a test can change an env var and observe the effect — including the
 * fail-closed behaviour, which is only meaningful if it can be exercised.
 */

export function isProduction(): boolean {
  return (process.env.AYA_ENV ?? 'development') === 'production'
}

export function isTest(): boolean {
  return (process.env.AYA_ENV ?? '') === 'test'
}

function str(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError('internal', `Env ${name} must be a non-negative integer, got "${raw}".`)
  }
  return parsed
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

/**
 * A secret that must exist in production.
 *
 * In development it falls back to a fixed, obviously-fake value so the app
 * boots. That value is never reachable in production: the throw below happens
 * first, and it happens at the point of use rather than at startup so a
 * misconfigured deployment fails on the specific request that needed the
 * secret, naming it.
 */
function secret(name: string): string {
  const value = process.env[name]
  if (value !== undefined && value !== '') return value
  if (isProduction()) {
    throw new AppError(
      'internal',
      `${name} is not set. Refusing to run in production without it.`,
    )
  }
  return `insecure-development-${name.toLowerCase()}`
}

export const secrets = {
  flag: () => secret('AYA_FLAG_SECRET'),
  auth: () => secret('AYA_AUTH_SECRET'),
  midtransServerKey: () => secret('MIDTRANS_SERVER_KEY'),
} as const

export const runnerConfig = {
  kind: (): 'docker' | 'stub' => (str('AYA_RUNNER', 'stub') === 'docker' ? 'docker' : 'stub'),
  image: (profile: 'python-crypto' | 'sage'): string =>
    profile === 'sage'
      ? str('AYA_RUNNER_IMAGE_SAGE', 'ayas-playground/runner-sage:1')
      : str('AYA_RUNNER_IMAGE_PYTHON', 'ayas-playground/runner-python-crypto:1'),
  timeoutMs: () => int('AYA_RUNNER_TIMEOUT_MS', 60_000),
  memoryMb: () => int('AYA_RUNNER_MEMORY_MB', 512),
  pidsLimit: () => int('AYA_RUNNER_PIDS_LIMIT', 128),
  maxOutputBytes: () => int('AYA_RUNNER_MAX_OUTPUT_BYTES', 262_144),
  tmpfsMb: () => int('AYA_RUNNER_TMPFS_MB', 64),
} as const

export const bundleLimits = {
  maxUploadBytes: () => int('AYA_MAX_UPLOAD_BYTES', 52_428_800), // 50 MiB
  maxUncompressedBytes: () => int('AYA_MAX_UNCOMPRESSED_BYTES', 209_715_200), // 200 MiB
  maxFiles: () => int('AYA_MAX_BUNDLE_FILES', 512),
} as const

export const commerceConfig = {
  disputeWindowHours: () => int('AYA_DISPUTE_WINDOW_HOURS', 72),
  commissionBps: () => int('AYA_COMMISSION_BPS', 1000),
  orderTtlMinutes: () => int('AYA_ORDER_TTL_MINUTES', 60),
  /** How many times fulfilment is retried before it waits for an operator. */
  maxFulfillAttempts: () => int('AYA_MAX_FULFILL_ATTEMPTS', 3),
  /** Multiplied by the attempt number. Set to 0 in tests. */
  fulfillRetryBaseMs: () => int('AYA_FULFILL_RETRY_BASE_MS', 2_000),
} as const

export const midtransConfig = {
  clientKey: () => str('MIDTRANS_CLIENT_KEY', ''),
  isProduction: () => bool('MIDTRANS_IS_PRODUCTION', false),
  snapBaseUrl: () =>
    bool('MIDTRANS_IS_PRODUCTION', false)
      ? 'https://app.midtrans.com/snap/v1'
      : 'https://app.sandbox.midtrans.com/snap/v1',
} as const

export const storageConfig = {
  dataDir: () => str('AYA_DATA_DIR', '.aya-data'),
  databaseUrl: (): string | undefined => {
    const url = process.env.DATABASE_URL
    return url === undefined || url === '' ? undefined : url
  },
} as const
