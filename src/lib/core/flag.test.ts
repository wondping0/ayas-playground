import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FLAG_FORMAT,
  REDACTION,
  assertValidFlagFormat,
  deriveFlag,
  ephemeralFlag,
  flagBody,
  formatFlag,
  isValidFlagFormat,
  scrubFlags,
} from './flag'

describe('flag formats', () => {
  it.each(['ayactf{%s}', 'HTB{%s}', 'flag-%s', '%s', 'a.b:c{%s}'])('accepts %s', (format) => {
    expect(isValidFlagFormat(format)).toBe(true)
  })

  it.each([
    ['no placeholder', 'ayactf{}'],
    ['two placeholders', '%s%s'],
    ['empty', ''],
    ['a stray percent', 'ay%ctf{%s}'],
    ['whitespace', 'aya ctf{%s}'],
    ['a newline', 'ayactf{%s}\n'],
    ['a shell metacharacter', 'ayactf{%s};rm'],
    ['too long', `${'a'.repeat(70)}{%s}`],
  ])('rejects %s', (_label, format) => {
    expect(isValidFlagFormat(format)).toBe(false)
    expect(() => assertValidFlagFormat(format)).toThrow()
  })
})

describe('deriveFlag', () => {
  const input = { challengeVersionId: 'ver_123', orderId: 'ord_456' }

  it('is deterministic', () => {
    expect(deriveFlag(input)).toBe(deriveFlag(input))
  })

  it('differs per order', () => {
    expect(deriveFlag(input)).not.toBe(deriveFlag({ ...input, orderId: 'ord_999' }))
  })

  it('differs per version', () => {
    expect(deriveFlag(input)).not.toBe(deriveFlag({ ...input, challengeVersionId: 'ver_999' }))
  })

  it('does not collide when ids are swapped across the separator', () => {
    // Without a delimiter, ("ab","c") and ("a","bc") would hash identically.
    const a = deriveFlag({ challengeVersionId: 'ab', orderId: 'c' })
    const b = deriveFlag({ challengeVersionId: 'a', orderId: 'bc' })
    expect(a).not.toBe(b)
  })

  it('honours a custom format', () => {
    const flag = deriveFlag({ ...input, format: 'HTB{%s}' })
    expect(flag.startsWith('HTB{')).toBe(true)
    expect(flag.endsWith('}')).toBe(true)
  })

  it('produces a body of stable length and charset', () => {
    const body = flagBody(deriveFlag(input), DEFAULT_FLAG_FORMAT)
    expect(body).toMatch(/^[a-z2-7]{20}$/)
  })

  it('rejects an invalid format rather than falling back', () => {
    expect(() => deriveFlag({ ...input, format: 'no-placeholder' })).toThrow()
  })
})

describe('ephemeralFlag', () => {
  it('is random each time', () => {
    expect(ephemeralFlag()).not.toBe(ephemeralFlag())
  })

  it('never equals a derived flag', () => {
    const derived = deriveFlag({ challengeVersionId: 'ver_1', orderId: 'ord_1' })
    for (let i = 0; i < 50; i++) {
      expect(ephemeralFlag()).not.toBe(derived)
    }
  })
})

describe('flagBody', () => {
  it('extracts the body', () => {
    expect(flagBody('ayactf{abcdef}', 'ayactf{%s}')).toBe('abcdef')
  })

  it('returns null when the flag does not match the format', () => {
    expect(flagBody('other{abcdef}', 'ayactf{%s}')).toBeNull()
    expect(flagBody('ayactf{}', 'ayactf{%s}')).toBeNull()
  })
})

describe('scrubFlags', () => {
  const flag = formatFlag('abcdefghijklmnopqrst', DEFAULT_FLAG_FORMAT)

  it('removes the whole flag', () => {
    const out = scrubFlags(`solved! ${flag}\n`, [flag])
    expect(out).not.toContain(flag)
    expect(out).toContain(REDACTION)
  })

  it('removes a bare body printed without the wrapper', () => {
    // Solvers routinely print only the inner part.
    const out = scrubFlags('recovered abcdefghijklmnopqrst end', [flag])
    expect(out).not.toContain('abcdefghijklmnopqrst')
  })

  it('is case-insensitive', () => {
    const out = scrubFlags('AYACTF{ABCDEFGHIJKLMNOPQRST}', [flag])
    expect(out).not.toMatch(/abcdefghijklmnopqrst/i)
  })

  it('removes every occurrence', () => {
    const out = scrubFlags(`${flag} and again ${flag}`, [flag])
    expect(out).not.toContain(flag)
    expect(out.match(new RegExp(REDACTION.replace(/[[\]]/g, '\\$&'), 'g'))).toHaveLength(2)
  })

  it('handles a custom format', () => {
    const custom = 'HTB{zzzzzzzzzzzzzzzzzzzz}'
    expect(scrubFlags(`got ${custom}`, [custom])).not.toContain('zzzzzzzzzzzzzzzzzzzz')
  })

  it('leaves unrelated text alone', () => {
    expect(scrubFlags('nothing to see', [flag])).toBe('nothing to see')
  })

  it('does not treat a short string as a flag worth globbing', () => {
    expect(scrubFlags('abc appears everywhere', ['abc'])).toBe('abc appears everywhere')
  })
})
