import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { createOrder, registerCommerceJobs } from '@/lib/commerce'
import { err } from '@/lib/core/errors'
import { handle, json, readJson } from '@/lib/http/respond'
import { getStore } from '@/lib/store'

registerCommerceJobs()

export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const user = await requireUser()
    const body = await readJson<{ listingId?: string; flagFormat?: string }>(request)

    if (!body.listingId) throw err.validation('A listing id is required.')

    const listing = await getStore().listings.get(body.listingId)
    if (!listing) throw err.notFound('Listing')

    const order = await createOrder({
      buyer: user,
      listing,
      ...(body.flagFormat ? { flagFormat: body.flagFormat } : {}),
    })

    return json(
      {
        order: {
          id: order.id,
          state: order.state,
          amount: order.amount,
          snapToken: order.snapToken,
          snapRedirectUrl: order.snapRedirectUrl,
        },
      },
      201,
    )
  })
}
