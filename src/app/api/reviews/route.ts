import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { createReview } from '@/lib/catalog'
import { err } from '@/lib/core/errors'
import { handle, json, readJson } from '@/lib/http/respond'

export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const user = await requireUser()
    const body = await readJson<{ orderId?: string; rating?: number; body?: string }>(request)

    if (!body.orderId) throw err.validation('An order id is required.')
    if (typeof body.rating !== 'number') throw err.validation('A rating is required.')

    const review = await createReview({
      reviewer: user,
      orderId: body.orderId,
      rating: body.rating,
      body: body.body ?? '',
    })

    return json({ review: { id: review.id, rating: review.rating } }, 201)
  })
}
