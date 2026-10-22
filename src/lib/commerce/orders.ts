import { commerceConfig } from '@/lib/core/config'
import { AppError, err } from '@/lib/core/errors'
import { DEFAULT_FLAG_FORMAT, assertValidFlagFormat, deriveFlag } from '@/lib/core/flag'
import { newId } from '@/lib/core/ids'
import { renderLicenseText, snapshotLicense } from '@/lib/core/license'
import { rupiah, splitCommission, type Rupiah } from '@/lib/core/money'
import type { Listing, Order, OrderState, User } from '@/lib/core/types'
import { fulfillOrder, getQueue, getRunner } from '@/lib/forge'
import { auditEntry, getStore } from '@/lib/store'
import { artifactKey, artifacts, bundleKey, bundles } from '@/lib/store/blobs'
import {
  assertTransition,
  canTransition,
  isIdempotentRepeat,
  isStale,
} from './order-state-machine'
import {
  assertValidSignature,
  getMidtransClient,
  mapTransactionStatus,
  parseNotification,
  type MidtransClient,
} from './midtrans'

/**
 * Orders.
 *
 * Everything that moves an order is here, and everything here goes through the
 * state machine. See .wondev/memory/commerce.md for the transition table and
 * the reasoning behind webhook-only progression.
 */

export const FULFILL_JOB = 'fulfill-order'
const DOWNLOAD_LIMIT = 10
const DOWNLOAD_WINDOW_DAYS = 30

/** Midtrans caps `order_id` at 50 characters. */
function midtransOrderIdFor(orderId: string): string {
  return `AYA-${orderId}`.slice(0, 50)
}

export interface CreateOrderInput {
  buyer: User
  listing: Listing
  /** The buyer's event prefix. Defaults to the challenge's own format. */
  flagFormat?: string
  client?: MidtransClient
}

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const store = getStore()
  const { buyer, listing } = input

  if (listing.state !== 'published') {
    throw err.conflict('This challenge is not currently for sale.')
  }
  if (listing.sellerId === buyer.id) {
    throw err.forbidden('You cannot buy your own challenge.')
  }

  const flagFormat = input.flagFormat ?? DEFAULT_FLAG_FORMAT
  assertValidFlagFormat(flagFormat)

  const amount = rupiah(listing.price)
  const { commission, net } = splitCommission(amount, commerceConfig.commissionBps())

  const id = newId('order')
  const now = new Date()
  const order: Order = {
    id,
    midtransOrderId: midtransOrderIdFor(id),
    buyerId: buyer.id,
    sellerId: listing.sellerId,
    listingId: listing.id,
    versionId: listing.versionId,
    amount,
    commission,
    sellerNet: net,
    licenseTerms: snapshotLicense(listing.licenseType),
    flagFormat,
    state: 'created',
    snapToken: null,
    snapRedirectUrl: null,
    paymentType: null,
    failureReason: null,
    fulfillAttempts: 0,
    expiresAt: new Date(now.getTime() + commerceConfig.orderTtlMinutes() * 60_000),
    paidAt: null,
    deliveredAt: null,
    disputeUntil: null,
    payoutMaturedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await store.orders.create(order)
  await store.audit.append(
    auditEntry(buyer.id, 'order.created', 'order', order.id, {
      listingId: listing.id,
      amount,
    }),
  )

  // The checkout token is obtained after the order exists, so a provider
  // failure leaves a recorded order that expires rather than a silent nothing.
  const client = input.client ?? getMidtransClient()
  const snap = await client.createTransaction({
    midtransOrderId: order.midtransOrderId,
    amount,
    items: [{ id: listing.id, name: listing.title, price: amount, quantity: 1 }],
    customer: { name: buyer.name, email: buyer.email },
    expiryMinutes: commerceConfig.orderTtlMinutes(),
  })

  const updated = await store.orders.compareAndSet(order.id, 'created', {
    state: 'awaiting_payment',
    snapToken: snap.token,
    snapRedirectUrl: snap.redirectUrl,
  })

  return updated ?? order
}

export interface NotificationOutcome {
  applied: boolean
  state: OrderState
  note: string
}

/**
 * Handle a Midtrans webhook.
 *
 * Returns rather than throws for every "we are not going to act on this" case,
 * because the caller answers 200 and a non-2xx makes Midtrans redeliver
 * forever. The only throw is an invalid signature, which is not Midtrans.
 */
export async function handleNotification(rawBody: unknown): Promise<NotificationOutcome> {
  const store = getStore()
  const notification = parseNotification(rawBody)
  assertValidSignature(notification)

  const order = await store.orders.getByMidtransOrderId(notification.order_id)
  if (!order) {
    await store.audit.append(
      auditEntry('system', 'order.notification.unknown', 'order', notification.order_id, {
        transactionStatus: notification.transaction_status,
      }),
    )
    // Retrying will not conjure the order. Acknowledge and stop.
    return { applied: false, state: 'created', note: 'Unknown order.' }
  }

  const mapping = mapTransactionStatus(notification)

  if (notification.payment_type && order.paymentType !== notification.payment_type) {
    await store.orders.update(order.id, { paymentType: notification.payment_type })
  }

  if (mapping.target === null) {
    await store.audit.append(
      auditEntry('system', 'order.notification.noop', 'order', order.id, {
        reason: mapping.reason,
        needsReview: mapping.needsReview,
      }),
    )
    return { applied: false, state: order.state, note: mapping.reason }
  }

  if (isIdempotentRepeat(order.state, mapping.target)) {
    return { applied: false, state: order.state, note: 'Already applied.' }
  }

  if (isStale(order.state, mapping.target)) {
    await store.audit.append(
      auditEntry('system', 'order.notification.stale', 'order', order.id, {
        current: order.state,
        requested: mapping.target,
      }),
    )
    return { applied: false, state: order.state, note: 'Superseded by later progress.' }
  }

  if (!canTransition(order.state, mapping.target)) {
    await store.audit.append(
      auditEntry('system', 'order.notification.illegal', 'order', order.id, {
        from: order.state,
        to: mapping.target,
        reason: mapping.reason,
      }),
    )
    return { applied: false, state: order.state, note: 'Not a legal transition.' }
  }

  const now = new Date()
  const updated = await store.orders.compareAndSet(order.id, order.state, {
    state: mapping.target,
    ...(mapping.target === 'paid' ? { paidAt: now } : {}),
    ...(mapping.target === 'failed' || mapping.target === 'cancelled'
      ? { failureReason: mapping.reason }
      : {}),
  })

  if (!updated) {
    // Another delivery of the same notification won the race.
    return { applied: false, state: order.state, note: 'Concurrently applied.' }
  }

  await store.audit.append(
    auditEntry('system', `order.${mapping.target}`, 'order', order.id, {
      from: order.state,
      reason: mapping.reason,
    }),
  )

  if (mapping.target === 'paid') {
    await getQueue().enqueue(FULFILL_JOB, { orderId: order.id }, { maxAttempts: 1 })
  }

  return { applied: true, state: updated.state, note: mapping.reason }
}

export interface FulfillOutcome {
  state: OrderState
  message: string
}

/**
 * Build and deliver a paid order.
 *
 * Runs the sandbox *after* money has changed hands, so every exit path leaves
 * the order in a state an operator can act on. It never leaves `fulfilling`.
 */
export async function runFulfillment(orderId: string): Promise<FulfillOutcome> {
  const store = getStore()
  const order = await store.orders.get(orderId)
  if (!order) throw err.notFound('Order')

  if (order.state === 'delivered') {
    return { state: 'delivered', message: 'Already delivered.' }
  }
  if (order.state !== 'paid' && order.state !== 'fulfill_failed') {
    return { state: order.state, message: `Nothing to do from "${order.state}".` }
  }

  const claimed = await store.orders.compareAndSet(order.id, order.state, {
    state: 'fulfilling',
    fulfillAttempts: order.fulfillAttempts + 1,
  })
  if (!claimed) {
    // Another worker claimed it first.
    const current = await store.orders.get(orderId)
    return { state: current?.state ?? order.state, message: 'Claimed by another worker.' }
  }

  const fail = async (message: string): Promise<FulfillOutcome> => {
    await store.orders.compareAndSet(order.id, 'fulfilling', {
      state: 'fulfill_failed',
      failureReason: message.slice(0, 500),
    })
    await store.audit.append(
      auditEntry('system', 'order.fulfill_failed', 'order', order.id, {
        attempt: claimed.fulfillAttempts,
        message: message.slice(0, 300),
      }),
    )
    // The order carries the attempt count, so retries survive a queue that
    // does not — and there is exactly one retry mechanism, not two.
    if (claimed.fulfillAttempts < commerceConfig.maxFulfillAttempts()) {
      try {
        await getQueue().enqueue(
          FULFILL_JOB,
          { orderId: order.id },
          {
            maxAttempts: 1,
            delayMs: commerceConfig.fulfillRetryBaseMs() * claimed.fulfillAttempts,
          },
        )
      } catch {
        // The queue is shutting down. The order is already in `fulfill_failed`
        // with a reason, so `recoverStalledFulfilments` picks it up next time —
        // losing the retry must not mask why the attempt failed.
      }
    }
    return { state: 'fulfill_failed', message }
  }

  try {
    const version = await store.versions.get(order.versionId)
    if (!version) return fail('The purchased challenge version no longer exists.')

    const challenge = await store.challenges.get(version.challengeId)
    const seller = await store.users.get(order.sellerId)
    const buyer = await store.users.get(order.buyerId)
    if (!challenge || !seller || !buyer) return fail('The order references a missing record.')

    const flag = deriveFlag({
      challengeVersionId: version.id,
      orderId: order.id,
      format: order.flagFormat,
    })

    const licenseText = renderLicenseText({
      terms: order.licenseTerms,
      challengeTitle: challenge.title,
      sellerName: seller.name,
      buyerName: buyer.name,
      orderId: order.id,
      purchasedAt: order.paidAt ?? order.createdAt,
    })

    const bundleData = await bundles.get(bundleKey(version.id))

    const result = await fulfillOrder({
      bundleData,
      spec: version.spec,
      flag,
      runner: getRunner(),
      terms: order.licenseTerms,
      licenseText,
      challengeTitle: challenge.title,
    })

    if (!result.ok || !result.artifact) {
      return fail(result.message)
    }

    const key = artifactKey(order.id)
    await artifacts.put(key, result.artifact)

    const now = new Date()
    await store.deliveries.create({
      id: newId('delivery'),
      orderId: order.id,
      storageKey: key,
      sizeBytes: result.artifact.length,
      sha256: result.sha256 ?? '',
      downloadCount: 0,
      maxDownloads: DOWNLOAD_LIMIT,
      expiresAt: new Date(now.getTime() + DOWNLOAD_WINDOW_DAYS * 86_400_000),
      createdAt: now,
    })

    const delivered = await store.orders.compareAndSet(order.id, 'fulfilling', {
      state: 'delivered',
      deliveredAt: now,
      disputeUntil: new Date(now.getTime() + commerceConfig.disputeWindowHours() * 3_600_000),
      failureReason: null,
    })

    if (!delivered) return { state: 'fulfilling', message: 'State changed during fulfilment.' }

    await store.payouts.accruePending(order.sellerId, order.sellerNet, now)
    await store.audit.append(
      auditEntry('system', 'order.delivered', 'order', order.id, {
        sizeBytes: result.artifact.length,
        sellerNet: order.sellerNet,
      }),
    )

    return { state: 'delivered', message: 'Delivered.' }
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Fulfilment failed unexpectedly.'
    return fail(message)
  }
}

export async function refundOrder(
  orderId: string,
  actor: string,
  reason: string,
): Promise<Order> {
  const store = getStore()
  const order = await store.orders.get(orderId)
  if (!order) throw err.notFound('Order')

  assertTransition(order.state, 'refunded')

  if (order.state === 'delivered') {
    if (order.disputeUntil && order.disputeUntil.getTime() <= Date.now()) {
      throw err.conflict('The dispute window for this order has closed.')
    }
  }

  const wasAccrued = order.state === 'delivered' && order.payoutMaturedAt === null
  const updated = await store.orders.compareAndSet(order.id, order.state, {
    state: 'refunded',
    failureReason: reason.slice(0, 500),
  })
  if (!updated) throw err.conflict('The order changed while the refund was being applied.')

  if (wasAccrued) {
    await store.payouts.reversePending(order.sellerId, order.sellerNet, new Date())
  }

  await store.audit.append(
    auditEntry(actor, 'order.refunded', 'order', order.id, {
      from: order.state,
      reason: reason.slice(0, 300),
      reversed: wasAccrued,
    }),
  )

  return updated
}

/** Move unpaid orders past their TTL to `expired`. */
export async function expireStaleOrders(now = new Date()): Promise<number> {
  const store = getStore()
  const stale = await store.orders.listExpired(now)
  let expired = 0

  for (const order of stale) {
    const updated = await store.orders.compareAndSet(order.id, order.state, { state: 'expired' })
    if (updated) {
      expired += 1
      await store.audit.append(
        auditEntry('system', 'order.expired', 'order', order.id, { from: order.state }),
      )
    }
  }
  return expired
}

/**
 * Re-enqueue paid orders whose fulfilment never finished.
 *
 * The queue is in-process, so a restart between `paid` and `delivered` drops
 * the job silently. Without this sweep the buyer's money sits in an order
 * nobody is working on, which is precisely the state the whole design is meant
 * to make impossible. Safe to run on a timer: `runFulfillment` claims each
 * order with a compare-and-set, so a duplicate enqueue is a no-op.
 */
export async function recoverStalledFulfilments(
  stalledForMs = 5 * 60_000,
  now = new Date(),
): Promise<number> {
  const store = getStore()
  const stalled = await store.orders.listStalledFulfilment(
    new Date(now.getTime() - stalledForMs),
  )

  for (const order of stalled) {
    // A `fulfilling` order is put back to `paid` first: nothing is working on
    // it, and `paid` is the state runFulfillment claims from.
    if (order.state === 'fulfilling') {
      await store.orders.compareAndSet(order.id, 'fulfilling', {
        state: 'fulfill_failed',
        failureReason: 'Fulfilment was interrupted and has been requeued.',
      })
    }
    await store.audit.append(
      auditEntry('system', 'order.fulfilment.recovered', 'order', order.id, {
        from: order.state,
      }),
    )
    await getQueue().enqueue(FULFILL_JOB, { orderId: order.id }, { maxAttempts: 1 })
  }

  return stalled.length
}

/** Move seller funds from pending to payable once the dispute window closes. */
export async function maturePayouts(now = new Date()): Promise<number> {
  const store = getStore()
  const ready = await store.orders.listDisputeWindowClosed(now)
  let matured = 0

  for (const order of ready) {
    // Stamped before the balance moves, so a crash cannot double-credit.
    await store.orders.update(order.id, { payoutMaturedAt: now })
    await store.payouts.maturePending(order.sellerId, order.sellerNet, now)
    await store.audit.append(
      auditEntry('system', 'payout.matured', 'order', order.id, {
        sellerId: order.sellerId,
        amount: order.sellerNet,
      }),
    )
    matured += 1
  }
  return matured
}

export function registerCommerceJobs(): void {
  getQueue().register<{ orderId: string }>(FULFILL_JOB, async ({ orderId }) => {
    await runFulfillment(orderId)
  })
}

export type { Rupiah }
