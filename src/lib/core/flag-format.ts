import { AppError } from './errors'

/**
 * Flag *formatting* — pure string work, no crypto.
 *
 * Split from flag.ts so the browser can validate a buyer's chosen format
 * without the derivation code (and `node:crypto`) being bundled with it. The
 * split is a boundary, not a convenience: nothing that can compute a flag
 * should ever be reachable from a client component.
 */

export const DEFAULT_FLAG_FORMAT = 'ayactf{%s}'
export const PLACEHOLDER = '%s'
export const FLAG_BODY_LENGTH = 20

/** Lowercase base32. No padding, no ambiguity read out of a terminal. */
export const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

const MAX_FORMAT_LENGTH = 64

/**
 * A format is buyer-supplied — they want their own event's prefix — so it ends
 * up inside generated files and a `docker run` environment. The charset is
 * narrow by construction.
 */
const FORMAT_CHARS = /^[A-Za-z0-9_\-{}[\]().:]*$/

export function assertValidFlagFormat(format: string): void {
  if (typeof format !== 'string' || format.length === 0) {
    throw new AppError('validation_failed', 'Flag format must be a non-empty string.')
  }
  if (format.length > MAX_FORMAT_LENGTH) {
    throw new AppError(
      'validation_failed',
      `Flag format must be at most ${MAX_FORMAT_LENGTH} characters.`,
    )
  }

  const parts = format.split(PLACEHOLDER)
  if (parts.length !== 2) {
    throw new AppError(
      'validation_failed',
      'Flag format must contain exactly one "%s" placeholder, for example "ayactf{%s}".',
    )
  }

  const [prefix, suffix] = parts as [string, string]
  if (!FORMAT_CHARS.test(prefix) || !FORMAT_CHARS.test(suffix)) {
    throw new AppError(
      'validation_failed',
      'Flag format may only use letters, digits, and _-{}[]().: around the placeholder.',
    )
  }
}

export function isValidFlagFormat(format: string): boolean {
  try {
    assertValidFlagFormat(format)
    return true
  } catch {
    return false
  }
}

export function formatFlag(body: string, format: string): string {
  assertValidFlagFormat(format)
  return format.replace(PLACEHOLDER, body)
}

/** Extract the body from a formatted flag, or null if it does not match. */
export function flagBody(flag: string, format: string): string | null {
  assertValidFlagFormat(format)
  const [prefix, suffix] = format.split(PLACEHOLDER) as [string, string]
  if (!flag.startsWith(prefix) || !flag.endsWith(suffix)) return null
  const body = flag.slice(prefix.length, flag.length - suffix.length)
  return body.length > 0 ? body : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const REDACTION = '[redacted-flag]'

/**
 * Remove flags from text before it is stored, logged, or shown.
 *
 * Sandbox output is the dangerous case: a solver prints the flag by design, and
 * that output is retained so a seller can debug a failed verification. Both the
 * full flag and its bare body are scrubbed, because a solver may well print
 * only the inner part.
 */
export function scrubFlags(text: string, flags: readonly string[]): string {
  let out = text
  for (const flag of flags) {
    if (!flag) continue
    const candidates = new Set<string>([flag])
    const body = flagBody(flag, DEFAULT_FLAG_FORMAT)
    if (body) candidates.add(body)
    // Also cover a custom format: anything between the outermost braces.
    const braced = /\{([^{}]{8,})\}/.exec(flag)
    if (braced?.[1]) candidates.add(braced[1])

    for (const candidate of candidates) {
      if (candidate.length < 8) continue
      out = out.replace(new RegExp(escapeRegExp(candidate), 'gi'), REDACTION)
    }
  }
  return out
}
