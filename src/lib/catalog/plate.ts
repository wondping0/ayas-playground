/**
 * The cipher plate.
 *
 * A buyer is not allowed to see the challenge, so the listing's visual anchor
 * is the one honest thing we can show: what its output *looks like*. The plate
 * is generated from the listing id, so it is stable, and shaped by the scheme,
 * so an RSA challenge reads as long decimal runs while a block cipher reads as
 * hex rows. It carries real information without leaking anything.
 *
 * It is decorative in the sense that the digits mean nothing. It is not
 * decorative in the sense that its *shape* is true.
 */

/** xorshift32, seeded from the id — same listing, same plate, forever. */
function seedFrom(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash === 0 ? 0x9e3779b9 : hash
}

function makeRandom(seed: number): () => number {
  let state = seed
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x1_0000_0000
  }
}

const HEX = '0123456789abcdef'
const DIGITS = '0123456789'
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function pick(random: () => number, alphabet: string, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(random() * alphabet.length)]
  }
  return out
}

function groups(random: () => number, alphabet: string, size: number, count: number): string {
  return Array.from({ length: count }, () => pick(random, alphabet, size)).join(' ')
}

export interface Plate {
  rows: string[]
  /** Rendered as the plate's caption — what the shape is. */
  shape: string
}

/**
 * Each scheme gets the texture its real output has.
 *
 * `stream-otp` deliberately repeats a fragment across rows: keystream reuse is
 * what the scheme *is*, and it is visible in a hexdump at a glance.
 */
export function cipherPlate(seed: string, scheme: string, rows = 6, width = 30): Plate {
  const random = makeRandom(seedFrom(`${seed}:${scheme}`))
  const line = (text: string) => text.slice(0, width).padEnd(width, ' ')

  switch (scheme) {
    case 'rsa-weakness':
    case 'prng': {
      return {
        shape: 'integers',
        rows: Array.from({ length: rows }, () => line(pick(random, DIGITS, width))),
      }
    }

    case 'classical': {
      return {
        shape: 'letter groups',
        rows: Array.from({ length: rows }, () => line(groups(random, ALPHA, 5, 5))),
      }
    }

    case 'stream-otp': {
      const repeated = pick(random, HEX, 8)
      return {
        shape: 'reused keystream',
        rows: Array.from({ length: rows }, (_, i) =>
          line(
            i % 2 === 0
              ? `${repeated} ${groups(random, HEX, 8, 2)}`
              : groups(random, HEX, 8, 3),
          ),
        ),
      }
    }

    case 'lattice': {
      return {
        shape: 'basis matrix',
        rows: Array.from({ length: rows }, () =>
          line(`[ ${groups(random, DIGITS, 4, 4)} ]`),
        ),
      }
    }

    case 'ecc': {
      return {
        shape: 'curve points',
        rows: Array.from({ length: rows }, () =>
          line(`(${pick(random, HEX, 10)}, ${pick(random, HEX, 10)})`),
        ),
      }
    }

    case 'signature': {
      return {
        shape: 'r, s pairs',
        rows: Array.from({ length: rows }, (_, i) =>
          line(`${i % 2 === 0 ? 'r' : 's'}=${pick(random, HEX, width - 3)}`),
        ),
      }
    }

    case 'protocol': {
      return {
        shape: 'handshake',
        rows: Array.from({ length: rows }, (_, i) =>
          line(`${i % 2 === 0 ? '->' : '<-'} ${groups(random, HEX, 6, 3)}`),
        ),
      }
    }

    default: {
      // symmetric-block, hash, and anything new: a hexdump.
      return {
        shape: 'hex blocks',
        rows: Array.from({ length: rows }, () => line(groups(random, HEX, 4, 6))),
      }
    }
  }
}

/** Glyphs the load animation cycles through before locking. */
export function scrambleRow(row: string, tick: number, seed: string): string {
  const random = makeRandom(seedFrom(`${seed}:${tick}`))
  return row
    .split('')
    .map((char) => (char === ' ' ? ' ' : HEX[Math.floor(random() * HEX.length)]!))
    .join('')
}
