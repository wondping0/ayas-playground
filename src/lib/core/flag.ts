import { createHmac, randomBytes } from 'node:crypto'
import { secrets } from './config'
import {
  BASE32,
  DEFAULT_FLAG_FORMAT,
  FLAG_BODY_LENGTH,
  assertValidFlagFormat,
  formatFlag,
} from './flag-format'

/**
 * Deriving flags. **Server only** — this module reaches for `node:crypto`.
 *
 * A buyer's flag is derived, never stored: given the secret, the version and
 * the order, it is always recomputable. There is therefore no flag column in
 * the database to leak, and no migration that could accidentally dump one.
 *
 * Pure format handling lives in flag-format.ts, which a client component may
 * import. Nothing here may.
 *
 * See .wondev/memory/decisions/0003-flag-modes.md for why every sale gets its
 * own flag at all.
 */

export {
  BASE32,
  DEFAULT_FLAG_FORMAT,
  FLAG_BODY_LENGTH,
  PLACEHOLDER,
  REDACTION,
  assertValidFlagFormat,
  flagBody,
  formatFlag,
  isValidFlagFormat,
  scrubFlags,
} from './flag-format'

function encodeBase32(bytes: Buffer, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += BASE32[bytes[i % bytes.length]! % 32]!
  }
  return out
}

export interface DeriveFlagInput {
  challengeVersionId: string
  orderId: string
  format?: string
}

/**
 * The buyer's flag. Deterministic given the secret, so a re-delivery or a
 * support question can recompute it without it ever having been persisted.
 */
export function deriveFlag(input: DeriveFlagInput): string {
  const format = input.format ?? DEFAULT_FLAG_FORMAT
  assertValidFlagFormat(format)

  const mac = createHmac('sha256', secrets.flag())
    .update('aya.flag.v1')
    .update('\x00')
    .update(input.challengeVersionId)
    .update('\x00')
    .update(input.orderId)
    .digest()

  return formatFlag(encodeBase32(mac, FLAG_BODY_LENGTH), format)
}

/**
 * A throwaway flag for a verification run.
 *
 * Never derived: a verification must not be able to reveal any buyer's flag,
 * and its output is retained for the seller to read.
 */
export function ephemeralFlag(format: string = DEFAULT_FLAG_FORMAT): string {
  assertValidFlagFormat(format)
  return formatFlag(encodeBase32(randomBytes(FLAG_BODY_LENGTH), FLAG_BODY_LENGTH), format)
}
