import { NextResponse } from 'next/server'
import { handleNotification, registerCommerceJobs } from '@/lib/commerce'
import { isAppError, toAppError } from '@/lib/core/errors'
import { json, readJson } from '@/lib/http/respond'

/**
 * The Midtrans webhook — the only thing that moves an order's payment state.
 *
 * Everything except a bad signature answers 200. A non-2xx makes Midtrans
 * redeliver, and redelivering will not fix an order we have already handled, do
 * not recognise, or refuse to transition.
 */

registerCommerceJobs()

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await readJson<unknown>(request)
    const outcome = await handleNotification(body)
    return json({ ok: true, applied: outcome.applied, note: outcome.note })
  } catch (thrown) {
    const error = toAppError(thrown)

    if (isAppError(thrown) && thrown.code === 'payment_signature_invalid') {
      // Not Midtrans. Refuse loudly.
      return json(error.toJSON(), 401)
    }
    if (isAppError(thrown) && thrown.code === 'validation_failed') {
      return json(error.toJSON(), 400)
    }

    console.error('[midtrans webhook]', thrown)
    // Ask for a redelivery: this one is on us.
    return json({ ok: false }, 500)
  }
}
