import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import {
  handleNotification,
  notificationAmount,
  offlinePaymentsAllowed,
  registerCommerceJobs,
  signNotification,
} from '@/lib/commerce'
import { AppError, err } from '@/lib/core/errors'
import { handle, json, readJson } from '@/lib/http/respond'
import { getStore } from '@/lib/store'

/**
 * Complete a payment locally, without Midtrans.
 *
 * It produces a *correctly signed* notification and sends it through the same
 * handler a real webhook uses — so the signature check is exercised rather than
 * bypassed, and there is never a reason to add a "skip verification" flag.
 *
 * Refuses to exist as soon as real Midtrans credentials are configured.
 */

registerCommerceJobs()

export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    // Two independent reasons this route may not fire, checked together: a
    // configured provider, and production. Either alone would be enough; both
    // are here because the failure mode is a free purchase.
    if (!offlinePaymentsAllowed()) {
      throw new AppError(
        'forbidden',
        'Payments must come from a signed Midtrans webhook here.',
      )
    }

    const user = await requireUser()
    const body = await readJson<{ orderId?: string; status?: string }>(request)
    if (!body.orderId) throw err.validation('An order id is required.')

    const order = await getStore().orders.get(body.orderId)
    if (!order) throw err.notFound('Order')
    if (order.buyerId !== user.id) throw err.forbidden('That order is not yours.')

    const outcome = await handleNotification(
      signNotification({
        order_id: order.midtransOrderId,
        status_code: '200',
        gross_amount: notificationAmount(order.amount),
        transaction_status: body.status ?? 'settlement',
        payment_type: 'qris',
      }),
    )

    return json({ applied: outcome.applied, state: outcome.state, note: outcome.note })
  })
}
