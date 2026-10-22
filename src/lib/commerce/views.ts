import { err } from '@/lib/core/errors'
import type { LicenseTerms } from '@/lib/core/license'
import type { OrderState, User } from '@/lib/core/types'
import { getStore } from '@/lib/store'

/**
 * Read models for the order pages.
 *
 * The UI goes through a plane rather than reaching the store, so authorization
 * has one home and a page cannot accidentally render somebody else's order.
 */

export interface OrderView {
  id: string
  state: OrderState
  stateLabel: string
  amount: number
  priceLabel: string
  flagFormat: string
  licenseTerms: LicenseTerms
  listing: { id: string; slug: string; title: string } | null
  sellerName: string
  buyerName: string
  failureReason: string | null
  paymentType: string | null
  createdAt: string
  paidAt: string | null
  deliveredAt: string | null
  disputeUntil: string | null
  expiresAt: string
  snapRedirectUrl: string | null
  delivery: { sizeBytes: number; downloadsLeft: number; expiresAt: string } | null
  reviewed: boolean
}

/** Buyer-facing wording for each state. Says what happens next, not jargon. */
const STATE_LABELS: Record<OrderState, string> = {
  created: 'Starting checkout',
  awaiting_payment: 'Waiting for payment',
  paid: 'Paid — building your copy',
  fulfilling: 'Building your copy',
  delivered: 'Ready to download',
  fulfill_failed: 'Build failed — we are on it',
  expired: 'Checkout expired',
  failed: 'Payment failed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
}

async function toView(orderId: string): Promise<OrderView> {
  const store = getStore()
  const order = await store.orders.get(orderId)
  if (!order) throw err.notFound('Order')

  const [listing, seller, buyer, delivery, review] = await Promise.all([
    store.listings.get(order.listingId),
    store.users.get(order.sellerId),
    store.users.get(order.buyerId),
    store.deliveries.getByOrder(order.id),
    store.reviews.getByOrder(order.id),
  ])

  return {
    id: order.id,
    state: order.state,
    stateLabel: STATE_LABELS[order.state],
    amount: order.amount,
    priceLabel: `Rp ${order.amount.toLocaleString('id-ID')}`,
    flagFormat: order.flagFormat,
    licenseTerms: order.licenseTerms,
    listing: listing ? { id: listing.id, slug: listing.slug, title: listing.title } : null,
    sellerName: seller?.name ?? 'Unknown',
    buyerName: buyer?.name ?? 'Unknown',
    failureReason: order.failureReason,
    paymentType: order.paymentType,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    disputeUntil: order.disputeUntil?.toISOString() ?? null,
    expiresAt: order.expiresAt.toISOString(),
    snapRedirectUrl: order.snapRedirectUrl,
    delivery: delivery
      ? {
          sizeBytes: delivery.sizeBytes,
          downloadsLeft: delivery.maxDownloads - delivery.downloadCount,
          expiresAt: delivery.expiresAt.toISOString(),
        }
      : null,
    reviewed: review !== null,
  }
}

export async function ordersForBuyer(user: User): Promise<OrderView[]> {
  const orders = await getStore().orders.listForBuyer(user.id, { limit: 100 })
  return Promise.all(orders.map((order) => toView(order.id)))
}

export async function orderForBuyer(orderId: string, user: User): Promise<OrderView> {
  const order = await getStore().orders.get(orderId)
  if (!order) throw err.notFound('Order')
  if (order.buyerId !== user.id && !user.roles.includes('admin')) {
    throw err.forbidden('That order is not yours.')
  }
  return toView(order.id)
}

export interface SellerSale {
  id: string
  state: OrderState
  listingTitle: string
  buyerName: string
  gross: number
  net: number
  createdAt: string
}

export async function salesForSeller(user: User): Promise<SellerSale[]> {
  const store = getStore()
  const orders = await store.orders.listForSeller(user.id, { limit: 100 })

  return Promise.all(
    orders.map(async (order) => {
      const [listing, buyer] = await Promise.all([
        store.listings.get(order.listingId),
        store.users.get(order.buyerId),
      ])
      return {
        id: order.id,
        state: order.state,
        listingTitle: listing?.title ?? 'Removed listing',
        buyerName: buyer?.name ?? 'Unknown',
        gross: order.amount,
        net: order.sellerNet,
        createdAt: order.createdAt.toISOString(),
      }
    }),
  )
}
