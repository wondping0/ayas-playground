import { err } from '@/lib/core/errors'
import { newId } from '@/lib/core/ids'
import { rupiah, type Rupiah } from '@/lib/core/money'
import type { PayoutBalance, PayoutRelease, User } from '@/lib/core/types'
import { auditEntry, getStore } from '@/lib/store'

/**
 * Seller balances.
 *
 * Release is manual in v1: an admin marks a payable balance paid and records
 * the bank reference. Automated disbursement means KYC onboarding, which is not
 * worth it before there is volume. The ledger shape is the same either way, so
 * automating it later does not move any of these numbers.
 */

export async function balanceFor(sellerId: string): Promise<PayoutBalance> {
  return getStore().payouts.getBalance(sellerId)
}

export async function pendingReleases(): Promise<PayoutBalance[]> {
  return getStore().payouts.listWithPayable()
}

export interface ReleaseInput {
  sellerId: string
  amount: number
  /** Bank transfer reference, so a payout line is reconstructible later. */
  reference: string
  admin: User
}

export async function releasePayout(input: ReleaseInput): Promise<PayoutRelease> {
  const store = getStore()

  if (!input.admin.roles.includes('admin')) {
    throw err.forbidden('Only an administrator can release a payout.')
  }

  const reference = input.reference.trim()
  if (reference.length < 3 || reference.length > 120) {
    throw err.validation('A payout needs a reference between 3 and 120 characters.')
  }

  const balance = await store.payouts.getBalance(input.sellerId)
  const amount = rupiah(input.amount) as Rupiah

  if (amount === 0) throw err.validation('A payout must be more than zero.')
  if (amount > balance.payable) {
    throw err.conflict(
      `That seller has Rp ${balance.payable.toLocaleString('id-ID')} payable, which is less than the requested amount.`,
    )
  }

  const release: PayoutRelease = {
    id: newId('payout'),
    sellerId: input.sellerId,
    amount,
    reference,
    releasedBy: input.admin.id,
    createdAt: new Date(),
  }

  await store.payouts.release(release)
  await store.audit.append(
    auditEntry(input.admin.id, 'payout.released', 'user', input.sellerId, {
      amount,
      reference,
    }),
  )

  return release
}

export async function releaseHistory(sellerId: string): Promise<PayoutRelease[]> {
  return getStore().payouts.listReleases(sellerId)
}
