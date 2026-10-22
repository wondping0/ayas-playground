import { describe, expect, it } from 'vitest'
import { ID_PREFIXES, isId, newId, type IdKind } from './ids'

const KINDS = Object.keys(ID_PREFIXES) as IdKind[]

describe('newId', () => {
  it.each(KINDS)('produces a recognisable %s id', (kind) => {
    const id = newId(kind)
    expect(id.startsWith(`${ID_PREFIXES[kind]}_`)).toBe(true)
    expect(isId(kind, id)).toBe(true)
  })

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 2_000 }, () => newId('order')))
    expect(ids.size).toBe(2_000)
  })

  it('sorts lexicographically by creation time', () => {
    const early = newId('order', 1_600_000_000_000)
    const late = newId('order', 1_700_000_000_000)
    expect(early < late).toBe(true)
  })

  it('excludes ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(newId('order').split('_')[1]).not.toMatch(/[ILOU]/)
    }
  })
})

describe('isId', () => {
  it('rejects an id of the wrong kind', () => {
    expect(isId('order', newId('user'))).toBe(false)
  })

  it.each([
    ['a non-string', 42],
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a bare prefix', 'ord_'],
    ['a truncated body', 'ord_ABC'],
    ['an over-long body', `ord_${'A'.repeat(30)}`],
    ['a lowercase body', `ord_${'a'.repeat(26)}`],
    ['an excluded character', `ord_I${'A'.repeat(25)}`],
    ['a prefix collision', 'ordX_ABCDEFGHJKMNPQRSTVWXYZ'],
  ])('rejects %s', (_label, value) => {
    expect(isId('order', value)).toBe(false)
  })
})
