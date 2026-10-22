/**
 * Money, as whole Indonesian Rupiah.
 *
 * The unit is one rupiah, not one sen, because that is the unit Midtrans
 * settles in: `gross_amount` must be an integer number of rupiah. Choosing the
 * same unit as the payment processor removes the entire class of bug where a
 * conversion happens in one direction but not the other.
 *
 * The brand exists so an arbitrary `number` cannot drift into a price field.
 */
export type Rupiah = number & { readonly __brand: 'Rupiah' }

export class MoneyError extends Error {}

export function rupiah(value: number): Rupiah {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Amount must be finite, got ${value}`)
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`Amount must be a whole rupiah, got ${value}`)
  }
  if (value < 0) {
    throw new MoneyError(`Amount must not be negative, got ${value}`)
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new MoneyError(`Amount exceeds safe integer range`)
  }
  return value as Rupiah
}

export const ZERO = rupiah(0)

export function add(a: Rupiah, b: Rupiah): Rupiah {
  return rupiah(a + b)
}

export function subtract(a: Rupiah, b: Rupiah): Rupiah {
  return rupiah(a - b)
}

/**
 * Apply a basis-point rate, rounding half-up.
 *
 * Commission and seller net are both derived from the same gross with this
 * function, and the caller subtracts to get the remainder — so the two always
 * sum back to the gross exactly, with no rounding gap that would have to be
 * reconciled by hand later.
 */
export function applyBps(amount: Rupiah, bps: number): Rupiah {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new MoneyError(`Basis points must be an integer in [0, 10000], got ${bps}`)
  }
  return rupiah(Math.round((amount * bps) / 10_000))
}

/** Split a gross amount into platform commission and seller net. */
export function splitCommission(
  gross: Rupiah,
  bps: number,
): { commission: Rupiah; net: Rupiah } {
  const commission = applyBps(gross, bps)
  return { commission, net: subtract(gross, commission) }
}

/** `1500000` -> `"Rp 1.500.000"`. Indonesian grouping, no decimals. */
export function formatRupiah(amount: Rupiah): string {
  return `Rp ${amount.toLocaleString('id-ID')}`
}

/** The exact string Midtrans expects in `gross_amount`. */
export function toMidtransAmount(amount: Rupiah): string {
  return String(amount)
}

export function isRupiah(value: unknown): value is Rupiah {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  )
}
