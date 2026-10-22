import { err } from '@/lib/core/errors'
import { newId } from '@/lib/core/ids'
import type { Review, User } from '@/lib/core/types'
import { auditEntry, getStore } from '@/lib/store'

/**
 * Reviews.
 *
 * Purchase-gated: a review requires a delivered order belonging to the
 * reviewer, one per order. That constraint is the only thing that makes the
 * rating on a listing worth anything, since anyone can write words.
 */

const MAX_BODY = 2_000

export interface CreateReviewInput {
  reviewer: User
  orderId: string
  rating: number
  body: string
}

export async function createReview(input: CreateReviewInput): Promise<Review> {
  const store = getStore()

  const order = await store.orders.get(input.orderId)
  if (!order) throw err.notFound('Order')
  if (order.buyerId !== input.reviewer.id) {
    throw err.forbidden('You can only review your own purchases.')
  }
  if (order.state !== 'delivered') {
    throw err.conflict('You can review a challenge once it has been delivered.')
  }

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw err.validation('A rating must be a whole number from 1 to 5.')
  }

  const body = input.body.trim()
  if (body.length > MAX_BODY) {
    throw err.validation(`A review must be at most ${MAX_BODY} characters.`)
  }

  const existing = await store.reviews.getByOrder(order.id)
  if (existing) throw err.conflict('You have already reviewed this purchase.')

  const listing = await store.listings.get(order.listingId)
  if (!listing) throw err.notFound('Listing')

  const review = await store.reviews.create({
    id: newId('review'),
    orderId: order.id,
    listingId: listing.id,
    challengeId: listing.challengeId,
    reviewerId: input.reviewer.id,
    reviewerName: input.reviewer.name,
    rating: input.rating,
    body,
    createdAt: new Date(),
  })

  await store.audit.append(
    auditEntry(input.reviewer.id, 'review.created', 'listing', listing.id, {
      orderId: order.id,
      rating: input.rating,
    }),
  )

  return review
}

export interface PublicReview {
  id: string
  reviewerName: string
  rating: number
  body: string
  createdAt: string
}

export async function reviewsForListing(listingId: string): Promise<PublicReview[]> {
  const store = getStore()
  const listing = await store.listings.get(listingId)
  if (!listing) return []

  // Reviews follow the challenge, not the listing, so a buyer of version 1
  // still informs somebody looking at version 3.
  const reviews = await store.reviews.listForChallenge(listing.challengeId)
  return reviews.map((review) => ({
    id: review.id,
    reviewerName: review.reviewerName,
    rating: review.rating,
    body: review.body,
    createdAt: review.createdAt.toISOString(),
  }))
}
