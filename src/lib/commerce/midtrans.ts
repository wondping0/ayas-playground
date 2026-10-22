import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { isProduction, midtransConfig, secrets } from '@/lib/core/config'
import { AppError } from '@/lib/core/errors'
import { toMidtransAmount, type Rupiah } from '@/lib/core/money'
import type { OrderState } from '@/lib/core/types'

/**
 * Midtrans.
 *
 * The payment rails that matter here — QRIS, GoPay, virtual account, bank
 * transfer — are all asynchronous. There is no moment at which the browser
 * knows the truth, so the webhook is the only thing that moves an order.
 * See decisions/0005-webhook-driven-orders.
 */

export const notificationSchema = z
  .object({
    order_id: z.string().min(1).max(120),
    status_code: z.string().min(1).max(10),
    /**
     * Kept as the raw string. Midtrans sends "150000.00" and signs *that*
     * exact text — reformatting it before hashing produces a signature that
     * never matches.
     */
    gross_amount: z.string().min(1).max(30),
    signature_key: z.string().min(1).max(256),
    transaction_status: z.string().min(1).max(40),
    fraud_status: z.string().max(40).optional(),
    payment_type: z.string().max(40).optional(),
    transaction_id: z.string().max(120).optional(),
    transaction_time: z.string().max(40).optional(),
    status_message: z.string().max(300).optional(),
  })
  .passthrough()

export type MidtransNotification = z.infer<typeof notificationSchema>

export function parseNotification(body: unknown): MidtransNotification {
  const result = notificationSchema.safeParse(body)
  if (!result.success) {
    throw new AppError('validation_failed', 'Malformed payment notification.')
  }
  return result.data
}

/** `sha512(order_id + status_code + gross_amount + ServerKey)`. */
export function computeSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
    .digest('hex')
}

export function verifySignature(
  notification: MidtransNotification,
  serverKey = secrets.midtransServerKey(),
): boolean {
  const expected = computeSignature(
    notification.order_id,
    notification.status_code,
    notification.gross_amount,
    serverKey,
  )
  const presented = notification.signature_key.toLowerCase()

  // Length is checked first because timingSafeEqual throws on a mismatch, and
  // a thrown exception is itself a timing signal.
  if (presented.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(presented, 'utf8'), Buffer.from(expected, 'utf8'))
}

export function assertValidSignature(
  notification: MidtransNotification,
  serverKey?: string,
): void {
  if (!verifySignature(notification, serverKey)) {
    throw new AppError('payment_signature_invalid', 'Payment notification signature is invalid.')
  }
}

export interface StatusMapping {
  /** null means "no state change" — the notification is informational. */
  target: OrderState | null
  reason: string
  /** Needs a human: Midtrans flagged the transaction as suspicious. */
  needsReview: boolean
}

/**
 * Midtrans `transaction_status` -> our order state.
 *
 * `capture` is the one that bites: it is only a payment when `fraud_status` is
 * `accept`. A `challenge` means Midtrans wants a human to decide, and treating
 * it as paid delivers a challenge for money that may be clawed back.
 */
export function mapTransactionStatus(notification: MidtransNotification): StatusMapping {
  const status = notification.transaction_status.toLowerCase()
  const fraud = notification.fraud_status?.toLowerCase()

  switch (status) {
    case 'capture':
      if (fraud === 'accept') return { target: 'paid', reason: 'capture/accept', needsReview: false }
      if (fraud === 'deny') return { target: 'failed', reason: 'capture/deny', needsReview: false }
      return {
        target: null,
        reason: `capture/${fraud ?? 'unknown'} — held for review`,
        needsReview: true,
      }
    case 'settlement':
      return { target: 'paid', reason: 'settlement', needsReview: false }
    case 'pending':
      return { target: null, reason: 'pending', needsReview: false }
    case 'deny':
      return { target: 'failed', reason: 'deny', needsReview: false }
    case 'cancel':
      return { target: 'cancelled', reason: 'cancel', needsReview: false }
    case 'expire':
      return { target: 'expired', reason: 'expire', needsReview: false }
    case 'failure':
      return { target: 'failed', reason: 'failure', needsReview: false }
    case 'refund':
    case 'partial_refund':
      return { target: 'refunded', reason: status, needsReview: false }
    default:
      return { target: null, reason: `unknown status "${status}"`, needsReview: true }
  }
}

// --- Snap -------------------------------------------------------------------

export interface SnapItem {
  id: string
  name: string
  price: Rupiah
  quantity: number
}

export interface CreateSnapInput {
  midtransOrderId: string
  amount: Rupiah
  items: SnapItem[]
  customer: { name: string; email: string }
  /** Minutes until the payment link expires. */
  expiryMinutes: number
}

export interface SnapTransaction {
  token: string
  redirectUrl: string
}

export interface MidtransClient {
  createTransaction(input: CreateSnapInput): Promise<SnapTransaction>
}

function authHeader(serverKey: string): string {
  return `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`
}

export class HttpMidtransClient implements MidtransClient {
  constructor(
    private readonly serverKey: string = secrets.midtransServerKey(),
    private readonly baseUrl: string = midtransConfig.snapBaseUrl(),
  ) {}

  async createTransaction(input: CreateSnapInput): Promise<SnapTransaction> {
    const body = {
      transaction_details: {
        order_id: input.midtransOrderId,
        // Snap wants an integer here. Names are truncated to Midtrans's limit
        // rather than sent long and rejected with an opaque 400.
        gross_amount: Number(toMidtransAmount(input.amount)),
      },
      item_details: input.items.map((item) => ({
        id: item.id.slice(0, 50),
        name: item.name.slice(0, 50),
        price: Number(toMidtransAmount(item.price)),
        quantity: item.quantity,
      })),
      customer_details: {
        first_name: input.customer.name.slice(0, 50),
        email: input.customer.email.slice(0, 100),
      },
      expiry: { unit: 'minute', duration: input.expiryMinutes },
      credit_card: { secure: true },
    }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: authHeader(this.serverKey),
        },
        body: JSON.stringify(body),
      })
    } catch (cause) {
      throw new AppError('payment_failed', 'Could not reach the payment provider.', { cause })
    }

    if (!response.ok) {
      // The provider's message can name the field it disliked; it is safe to
      // surface because we authored every value in the request.
      const text = await response.text().catch(() => '')
      throw new AppError('payment_failed', 'The payment provider rejected the checkout.', {
        details: { status: response.status, body: text.slice(0, 500) },
      })
    }

    const json = (await response.json()) as { token?: string; redirect_url?: string }
    if (!json.token || !json.redirect_url) {
      throw new AppError('payment_failed', 'The payment provider returned no checkout token.')
    }

    return { token: json.token, redirectUrl: json.redirect_url }
  }
}

/**
 * A Snap client that issues fake tokens.
 *
 * Used when no Midtrans key is configured, so the whole purchase flow can be
 * exercised locally. It never claims a payment succeeded — that still requires
 * a correctly signed notification, which is the point.
 */
export class OfflineMidtransClient implements MidtransClient {
  async createTransaction(input: CreateSnapInput): Promise<SnapTransaction> {
    return {
      token: `offline-${input.midtransOrderId}`,
      redirectUrl: `/checkout/offline/${encodeURIComponent(input.midtransOrderId)}`,
    }
  }
}

/**
 * Fails closed in production.
 *
 * Falling back to the offline client when no key is configured would be a free
 * checkout: `/api/payments/offline` marks an order paid, and it decides whether
 * it is allowed to exist by asking *this* function. A deployment that forgot
 * MIDTRANS_SERVER_KEY must refuse to sell, not sell for nothing.
 */
export function getMidtransClient(): MidtransClient {
  const key = process.env.MIDTRANS_SERVER_KEY
  const configured = Boolean(key) && key!.length > 0 && !key!.startsWith('SB-Mid-server-TESTKEY')

  if (configured) return new HttpMidtransClient()

  if (isProduction()) {
    throw new AppError(
      'internal',
      'MIDTRANS_SERVER_KEY is not set. Refusing to accept payments in production without it.',
    )
  }

  return new OfflineMidtransClient()
}

export function offlinePaymentsAllowed(): boolean {
  if (isProduction()) return false
  try {
    return getMidtransClient() instanceof OfflineMidtransClient
  } catch {
    return false
  }
}

/**
 * Build a correctly signed notification.
 *
 * This exists so local development and tests never need a "skip the signature
 * check" flag — the temptation to add one is exactly how the check ends up
 * disabled in production.
 */
export interface NotificationFields {
  order_id: string
  status_code: string
  gross_amount: string
  transaction_status: string
  fraud_status?: string
  payment_type?: string
  transaction_id?: string
  transaction_time?: string
  status_message?: string
  [key: string]: unknown
}

export function signNotification(
  fields: NotificationFields,
  serverKey = secrets.midtransServerKey(),
): MidtransNotification {
  return {
    ...fields,
    signature_key: computeSignature(
      fields.order_id,
      fields.status_code,
      fields.gross_amount,
      serverKey,
    ),
  }
}

/** The `gross_amount` text Midtrans uses for IDR in notifications. */
export function notificationAmount(amount: Rupiah): string {
  return `${toMidtransAmount(amount)}.00`
}
