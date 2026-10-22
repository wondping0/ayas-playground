import type { Difficulty, SandboxProfile } from '@/lib/core/bundle'

/**
 * The cryptography scheme taxonomy.
 *
 * A buyer cannot read a crypto challenge before buying without spoiling it, so
 * the scheme tag is how they decide whether it fits the slot they need to fill.
 * It is data, not an enum scattered through the code, so adding one is an edit
 * here plus a row in .wondev/memory/crypto-taxonomy.md.
 */

export interface Scheme {
  id: string
  name: string
  /** What a player notices that identifies this archetype. */
  tell: string
  /** The attacks that usually apply. Shown to sellers, not on public cards. */
  mechanics: string[]
  /** The profile these challenges usually need. */
  suggestedProfile: SandboxProfile
}

export const SCHEMES: readonly Scheme[] = [
  {
    id: 'rsa-weakness',
    name: 'RSA weakness',
    tell: 'small e, shared or close primes, a partial key leak',
    mechanics: ['Håstad broadcast', 'Coppersmith', 'common modulus', 'Fermat', 'Wiener'],
    suggestedProfile: 'python-crypto',
  },
  {
    id: 'symmetric-block',
    name: 'Block cipher misuse',
    tell: 'repeating ECB blocks, or CBC with an oracle',
    mechanics: ['ECB cut-and-paste', 'CBC bit-flipping', 'padding oracle'],
    suggestedProfile: 'python-crypto',
  },
  {
    id: 'stream-otp',
    name: 'Keystream reuse',
    tell: 'a reused nonce or a one-time pad used twice',
    mechanics: ['XOR crib-dragging', 'many-time-pad'],
    suggestedProfile: 'python-crypto',
  },
  {
    id: 'signature',
    name: 'Signature flaw',
    tell: 'a repeated or biased nonce across ECDSA/DSA signatures',
    mechanics: ['nonce-reuse key recovery', 'biased-k lattice'],
    suggestedProfile: 'sage',
  },
  {
    id: 'classical',
    name: 'Classical cipher',
    tell: 'substitution or transposition, often with a theme',
    mechanics: ['frequency analysis', 'cipher identification'],
    suggestedProfile: 'python-crypto',
  },
  {
    id: 'hash',
    name: 'Hash weakness',
    tell: 'a MAC built by concatenation, or a truncated digest',
    mechanics: ['length extension', 'birthday collision', 'MAC forgery'],
    suggestedProfile: 'python-crypto',
  },
  {
    id: 'prng',
    name: 'PRNG prediction',
    tell: 'a stream of "random" values you are allowed to observe',
    mechanics: ['Mersenne Twister state recovery', 'LCG lattice', 'seed brute-force'],
    suggestedProfile: 'python-crypto',
  },
  {
    id: 'lattice',
    name: 'Lattice / knapsack',
    tell: 'a hidden number problem, truncated LCG, or knapsack',
    mechanics: ['LLL', 'Babai nearest plane', 'hidden number problem'],
    suggestedProfile: 'sage',
  },
  {
    id: 'ecc',
    name: 'Elliptic curve',
    tell: 'a curve you are allowed to choose, or one with suspicious order',
    mechanics: ['invalid-curve attack', 'MOV', "Smart's attack"],
    suggestedProfile: 'sage',
  },
  {
    id: 'protocol',
    name: 'Protocol flaw',
    tell: 'a key exchange or handshake you can interfere with',
    mechanics: ['small-subgroup', 'downgrade', 'replay'],
    suggestedProfile: 'python-crypto',
  },
]

const BY_ID = new Map(SCHEMES.map((scheme) => [scheme.id, scheme]))

export function getScheme(id: string): Scheme | undefined {
  return BY_ID.get(id)
}

export function isKnownScheme(id: string): boolean {
  return BY_ID.has(id)
}

export function unknownSchemes(ids: readonly string[]): string[] {
  return ids.filter((id) => !BY_ID.has(id))
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  insane: 'Insane',
}

export const DIFFICULTY_ORDER: readonly Difficulty[] = ['easy', 'medium', 'hard', 'insane']

/**
 * Solver runtime is deliberately absent from this module.
 *
 * A Coppersmith attack taking four minutes of CPU can be an easy challenge; a
 * five-line XOR can be brutal. Duration is recorded because it is an
 * operational fact about the sandbox budget, and it must never be presented as
 * a difficulty signal.
 */
