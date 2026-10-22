import { err } from '@/lib/core/errors'
import type { Delivery, User } from '@/lib/core/types'
import { auditEntry, getStore } from '@/lib/store'
import { artifacts } from '@/lib/store/blobs'
import { signDownloadToken, verifyDownloadToken } from './delivery-token'

/**
 * Handing a buyer their artifact.
 *
 * The link is signed and short-lived, and each use is counted. None of that
 * stops a determined buyer from sharing the file itself — the per-order flag is
 * what gives attribution when they do. See decisions/0003-flag-modes.
 */

const LINK_TTL_MS = 15 * 60 * 1000

export interface DownloadLink {
  token: string
  expiresAt: Date
  remaining: number
  sizeBytes: number
}

export async function issueDownloadLink(orderId: string, user: User): Promise<DownloadLink> {
  const store = getStore()

  const order = await store.orders.get(orderId)
  if (!order) throw err.notFound('Order')
  if (order.buyerId !== user.id && !user.roles.includes('admin')) {
    throw err.forbidden('That order is not yours.')
  }
  if (order.state !== 'delivered') {
    throw err.conflict(`This order is "${order.state}" — there is nothing to download yet.`)
  }

  const delivery = await store.deliveries.getByOrder(order.id)
  if (!delivery) throw err.notFound('Delivery')

  if (delivery.expiresAt.getTime() <= Date.now()) {
    throw err.conflict('The download window for this order has closed.')
  }
  if (delivery.downloadCount >= delivery.maxDownloads) {
    throw err.conflict('This order has reached its download limit.')
  }

  const expiresAt = new Date(Math.min(Date.now() + LINK_TTL_MS, delivery.expiresAt.getTime()))
  return {
    token: signDownloadToken(delivery.id, expiresAt),
    expiresAt,
    remaining: delivery.maxDownloads - delivery.downloadCount,
    sizeBytes: delivery.sizeBytes,
  }
}

export interface DownloadPayload {
  filename: string
  data: Buffer
  delivery: Delivery
}

/**
 * Redeem a token.
 *
 * The count is consumed *before* the bytes are read, so a caller cannot spend a
 * slot-free download by aborting mid-transfer.
 */
export async function redeemDownload(token: string, user: User): Promise<DownloadPayload> {
  const store = getStore()
  const claim = verifyDownloadToken(token)

  const delivery = await store.deliveries.get(claim.deliveryId)
  if (!delivery) throw err.notFound('Delivery')

  const order = await store.orders.get(delivery.orderId)
  if (!order) throw err.notFound('Order')

  // A signed token is a capability, but it is still checked against the
  // session: a link forwarded to somebody else should not work.
  if (order.buyerId !== user.id && !user.roles.includes('admin')) {
    throw err.forbidden('That download is not yours.')
  }
  if (order.state !== 'delivered') {
    throw err.conflict('This order is no longer downloadable.')
  }

  const consumed = await store.deliveries.consumeDownload(delivery.id)
  if (!consumed) {
    throw err.conflict('This order has reached its download limit.')
  }

  const data = await artifacts.get(delivery.storageKey)

  await store.audit.append(
    auditEntry(user.id, 'delivery.downloaded', 'order', order.id, {
      count: consumed.downloadCount,
      of: consumed.maxDownloads,
    }),
  )

  const listing = await store.listings.get(order.listingId)
  const base = (listing?.slug ?? 'challenge').replace(/[^a-z0-9-]/g, '')

  return { filename: `${base}-${order.id}.zip`, data, delivery: consumed }
}
