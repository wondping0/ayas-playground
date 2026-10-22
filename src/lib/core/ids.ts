import { randomBytes } from 'node:crypto'

/**
 * Crockford base32, excluding I, L, O and U so an id read aloud or retyped from
 * a support ticket cannot be transcribed into a different one.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const TIME_CHARS = 10
const RANDOM_CHARS = 16

/**
 * ULID-shaped: 48 bits of timestamp then 80 bits of randomness, base32.
 *
 * Lexicographic order matches creation order, which is what lets listing and
 * order pages paginate on the primary key without a separate sort column.
 */
function ulid(now: number): string {
  let time = ''
  let t = now
  for (let i = TIME_CHARS - 1; i >= 0; i--) {
    time = ALPHABET[t % 32]! + time
    t = Math.floor(t / 32)
  }

  const bytes = randomBytes(RANDOM_CHARS)
  let random = ''
  for (let i = 0; i < RANDOM_CHARS; i++) {
    random += ALPHABET[bytes[i]! % 32]!
  }

  return time + random
}

export const ID_PREFIXES = {
  user: 'usr',
  challenge: 'chl',
  version: 'ver',
  verification: 'vrf',
  listing: 'lst',
  order: 'ord',
  license: 'lic',
  delivery: 'dlv',
  review: 'rev',
  payout: 'pay',
  audit: 'aud',
  run: 'run',
  session: 'ses',
} as const

export type IdKind = keyof typeof ID_PREFIXES

export function newId(kind: IdKind, now = Date.now()): string {
  return `${ID_PREFIXES[kind]}_${ulid(now)}`
}

export function isId(kind: IdKind, value: unknown): value is string {
  if (typeof value !== 'string') return false
  const prefix = `${ID_PREFIXES[kind]}_`
  if (!value.startsWith(prefix)) return false
  const body = value.slice(prefix.length)
  if (body.length !== TIME_CHARS + RANDOM_CHARS) return false
  for (const ch of body) {
    if (!ALPHABET.includes(ch)) return false
  }
  return true
}
