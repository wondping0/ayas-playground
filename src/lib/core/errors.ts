/**
 * The error taxonomy.
 *
 * Expected, handled conditions are an `AppError` with a code from this list.
 * Programming bugs are not — they throw whatever they throw and crash loudly,
 * because a bug wrapped in a structured error is a bug nobody notices.
 */
export const ERROR_CODES = {
  // --- Access ---
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,

  // --- Bundles ---
  bundle_invalid: 422,
  bundle_too_large: 413,
  bundle_unsafe_archive: 422,

  // --- Verification ---
  verification_required: 409,
  verification_failed: 422,

  // --- Sandbox ---
  sandbox_unavailable: 503,
  sandbox_timeout: 504,
  sandbox_error: 500,

  // --- Commerce ---
  payment_signature_invalid: 401,
  illegal_transition: 409,
  payment_failed: 402,
  delivery_expired: 410,
  delivery_exhausted: 410,
  license_violation: 403,

  // --- Catch-all ---
  internal: 500,
} as const

export type ErrorCode = keyof typeof ERROR_CODES

export interface AppErrorOptions {
  /** Structured, already-safe context for the client. Never put a flag here. */
  details?: Record<string, unknown>
  cause?: unknown
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: Record<string, unknown> | undefined

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'AppError'
    this.code = code
    this.status = ERROR_CODES[code]
    this.details = options.details
  }

  /** The shape sent over the wire. Deliberately has no stack and no cause. */
  toJSON(): { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    }
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

export const err = {
  unauthenticated: (m = 'Sign in to continue.') => new AppError('unauthenticated', m),
  forbidden: (m = 'You do not have access to this.') => new AppError('forbidden', m),
  notFound: (what = 'Resource') => new AppError('not_found', `${what} not found.`),
  conflict: (m: string) => new AppError('conflict', m),
  validation: (m: string, details?: Record<string, unknown>) =>
    new AppError('validation_failed', m, details ? { details } : {}),
  internal: (m = 'Something went wrong.', cause?: unknown) =>
    new AppError('internal', m, cause !== undefined ? { cause } : {}),
} as const

/**
 * Convert anything thrown into an AppError for a response boundary.
 *
 * An unrecognized throw becomes a generic `internal` with a fixed message: the
 * original is preserved as `cause` for the server log but never reaches the
 * client, because it may carry a filesystem path, a query, or seller code output.
 */
export function toAppError(thrown: unknown): AppError {
  if (isAppError(thrown)) return thrown
  return err.internal('Something went wrong.', thrown)
}
