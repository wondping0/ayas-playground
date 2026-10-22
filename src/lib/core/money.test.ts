import { describe, expect, it } from 'vitest'
import {
  add,
  applyBps,
  formatRupiah,
  MoneyError,
  rupiah,
  splitCommission,
  subtract,
  toMidtransAmount,
} from './money'

describe('rupiah', () => {
  it('accepts whole non-negative amounts', () => {
    expect(rupiah(0)).toBe(0)
    expect(rupiah(150_000)).toBe(150_000)
  })

  it.each([
    ['a fraction', 1500.5],
    ['a negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s', (_label, value) => {
    expect(() => rupiah(value)).toThrow(MoneyError)
  })
})

describe('arithmetic', () => {
  it('adds and subtracts', () => {
    expect(add(rupiah(10_000), rupiah(5_000))).toBe(15_000)
    expect(subtract(rupiah(10_000), rupiah(5_000))).toBe(5_000)
  })

  it('refuses to produce a negative result', () => {
    expect(() => subtract(rupiah(1_000), rupiah(2_000))).toThrow(MoneyError)
  })
})

describe('applyBps', () => {
  it('applies a rate', () => {
    expect(applyBps(rupiah(100_000), 1000)).toBe(10_000)
    expect(applyBps(rupiah(100_000), 0)).toBe(0)
    expect(applyBps(rupiah(100_000), 10_000)).toBe(100_000)
  })

  it('rounds half up', () => {
    // 12345 * 1000 / 10000 = 1234.5
    expect(applyBps(rupiah(12_345), 1000)).toBe(1_235)
  })

  it.each([-1, 10_001, 1.5])('rejects out-of-range bps %s', (bps) => {
    expect(() => applyBps(rupiah(1_000), bps)).toThrow(MoneyError)
  })
})

describe('splitCommission', () => {
  it('always sums back to the gross exactly', () => {
    // The property that matters: no rounding gap anyone has to reconcile later.
    for (const gross of [1, 7, 99, 12_345, 150_000, 999_999, 1_000_000_007]) {
      for (const bps of [0, 1, 250, 1000, 3333, 9999, 10_000]) {
        const { commission, net } = splitCommission(rupiah(gross), bps)
        expect(commission + net).toBe(gross)
        expect(Number.isInteger(commission)).toBe(true)
        expect(Number.isInteger(net)).toBe(true)
        expect(commission).toBeGreaterThanOrEqual(0)
        expect(net).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('presentation', () => {
  it('formats with Indonesian grouping and no decimals', () => {
    expect(formatRupiah(rupiah(1_500_000))).toBe('Rp 1.500.000')
    expect(formatRupiah(rupiah(0))).toBe('Rp 0')
  })

  it('sends Midtrans an integer string', () => {
    expect(toMidtransAmount(rupiah(150_000))).toBe('150000')
    expect(toMidtransAmount(rupiah(0))).toBe('0')
  })
})
