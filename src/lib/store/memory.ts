import { AppError, err } from '@/lib/core/errors'
import { newId } from '@/lib/core/ids'
import { ZERO, rupiah, type Rupiah } from '@/lib/core/money'
import type {
  AuditEntry,
  Challenge,
  ChallengeVersion,
  Delivery,
  Listing,
  Order,
  OrderState,
  PayoutBalance,
  PayoutRelease,
  Review,
  User,
  Verification,
} from '@/lib/core/types'
import type {
  AuditRepo,
  ChallengeRepo,
  DeliveryRepo,
  ListingQuery,
  ListingRepo,
  OrderRepo,
  Page,
  PayoutRepo,
  ReviewRepo,
  Store,
  UserRepo,
  VerificationRepo,
  VersionRepo,
} from './types'

/**
 * The in-memory store.
 *
 * This is the default, and it is what lets `npm run dev` and the whole test
 * suite run with no Postgres. It therefore has to behave like a database, not
 * like a pile of shared objects: every read and write is deep-cloned, so a
 * caller mutating a returned object cannot silently corrupt stored state and
 * pass tests that Postgres would fail.
 */

function clone<T>(value: T): T {
  return structuredClone(value)
}

function paginate<T>(items: T[], page?: Page): T[] {
  const offset = page?.offset ?? 0
  const limit = page?.limit ?? 50
  return items.slice(offset, offset + limit)
}

function byNewest<T extends { createdAt: Date }>(a: T, b: T): number {
  return b.createdAt.getTime() - a.createdAt.getTime()
}

class MemoryUserRepo implements UserRepo {
  private readonly items = new Map<string, User>()

  async create(user: User): Promise<User> {
    if (await this.getByEmail(user.email)) {
      throw err.conflict('An account with that email already exists.')
    }
    this.items.set(user.id, clone(user))
    return clone(user)
  }

  async get(id: string): Promise<User | null> {
    const found = this.items.get(id)
    return found ? clone(found) : null
  }

  async getByEmail(email: string): Promise<User | null> {
    const needle = email.trim().toLowerCase()
    for (const user of this.items.values()) {
      if (user.email.toLowerCase() === needle) return clone(user)
    }
    return null
  }

  async update(id: string, patch: Partial<User>): Promise<User> {
    const existing = this.items.get(id)
    if (!existing) throw err.notFound('User')
    const next = { ...existing, ...clone(patch), id: existing.id }
    this.items.set(id, next)
    return clone(next)
  }

  async count(): Promise<number> {
    return this.items.size
  }

  clear(): void {
    this.items.clear()
  }
}

class MemoryChallengeRepo implements ChallengeRepo {
  private readonly items = new Map<string, Challenge>()

  async create(challenge: Challenge): Promise<Challenge> {
    if (await this.getBySlug(challenge.slug)) {
      throw err.conflict(`A challenge with slug "${challenge.slug}" already exists.`)
    }
    this.items.set(challenge.id, clone(challenge))
    return clone(challenge)
  }

  async get(id: string): Promise<Challenge | null> {
    const found = this.items.get(id)
    return found ? clone(found) : null
  }

  async getBySlug(slug: string): Promise<Challenge | null> {
    for (const item of this.items.values()) {
      if (item.slug === slug) return clone(item)
    }
    return null
  }

  async listForSeller(sellerId: string, page?: Page): Promise<Challenge[]> {
    const items = [...this.items.values()]
      .filter((c) => c.sellerId === sellerId)
      .sort(byNewest)
    return paginate(items, page).map(clone)
  }

  async update(id: string, patch: Partial<Challenge>): Promise<Challenge> {
    const existing = this.items.get(id)
    if (!existing) throw err.notFound('Challenge')
    const next = { ...existing, ...clone(patch), id: existing.id, updatedAt: new Date() }
    this.items.set(id, next)
    return clone(next)
  }

  clear(): void {
    this.items.clear()
  }
}

class MemoryVersionRepo implements VersionRepo {
  private readonly items = new Map<string, ChallengeVersion>()

  async create(version: ChallengeVersion): Promise<ChallengeVersion> {
    this.items.set(version.id, clone(version))
    return clone(version)
  }

  async get(id: string): Promise<ChallengeVersion | null> {
    const found = this.items.get(id)
    return found ? clone(found) : null
  }

  async listForChallenge(challengeId: string): Promise<ChallengeVersion[]> {
    return [...this.items.values()]
      .filter((v) => v.challengeId === challengeId)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(clone)
  }

  async nextOrdinal(challengeId: string): Promise<number> {
    const existing = [...this.items.values()].filter((v) => v.challengeId === challengeId)
    return existing.reduce((max, v) => Math.max(max, v.ordinal), 0) + 1
  }

  clear(): void {
    this.items.clear()
  }
}

class MemoryVerificationRepo implements VerificationRepo {
  private readonly items = new Map<string, Verification>()

  async create(verification: Verification): Promise<Verification> {
    this.items.set(verification.id, clone(verification))
    return clone(verification)
  }

  async get(id: string): Promise<Verification | null> {
    const found = this.items.get(id)
    return found ? clone(found) : null
  }

  async listForVersion(versionId: string): Promise<Verification[]> {
    return [...this.items.values()]
      .filter((v) => v.versionId === versionId)
      .sort(byNewest)
      .map(clone)
  }

  async latestForVersion(versionId: string): Promise<Verification | null> {
    const [first] = await this.listForVersion(versionId)
    return first ?? null
  }

  async passingForHash(versionId: string, bundleHash: string): Promise<Verification | null> {
    const match = [...this.items.values()]
      .filter(
        (v) => v.versionId === versionId && v.bundleHash === bundleHash && v.verdict === 'passed',
      )
      .sort(byNewest)[0]
    return match ? clone(match) : null
  }

  clear(): void {
    this.items.clear()
  }
}

class MemoryListingRepo implements ListingRepo {
  private readonly items = new Map<string, Listing>()

  constructor(private readonly reviews: MemoryReviewRepo) {}

  async create(listing: Listing): Promise<Listing> {
    if (await this.getBySlug(listing.slug)) {
      throw err.conflict(`A listing with slug "${listing.slug}" already exists.`)
    }
    this.items.set(listing.id, clone(listing))
    return clone(listing)
  }

  async get(id: string): Promise<Listing | null> {
    const found = this.items.get(id)
    return found ? clone(found) : null
  }

  async getBySlug(slug: string): Promise<Listing | null> {
    for (const item of this.items.values()) {
      if (item.slug === slug) return clone(item)
    }
    return null
  }

  private match(listing: Listing, query: ListingQuery): boolean {
    if (query.state && listing.state !== query.state) return false
    if (query.sellerId && listing.sellerId !== query.sellerId) return false
    if (query.difficulty && listing.difficulty !== query.difficulty) return false
    if (query.maxPrice !== undefined && listing.price > query.maxPrice) return false
    if (query.schemes?.length) {
      if (!query.schemes.some((s) => listing.schemes.includes(s))) return false
    }
    if (query.search) {
      const needle = query.search.trim().toLowerCase()
      const haystack = `${listing.title} ${listing.summary}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  }

  private async sorted(query: ListingQuery): Promise<Listing[]> {
    const matched = [...this.items.values()].filter((l) => this.match(l, query))
    switch (query.sort) {
      case 'price-asc':
        return matched.sort((a, b) => a.price - b.price)
      case 'price-desc':
        return matched.sort((a, b) => b.price - a.price)
      case 'rating': {
        const scored = await Promise.all(
          matched.map(async (l) => ({
            listing: l,
            score: (await this.reviews.summary(l.challengeId)).average,
          })),
        )
        return scored.sort((a, b) => b.score - a.score).map((s) => s.listing)
      }
      default:
        return matched.sort(byNewest)
    }
  }

  async query(query: ListingQuery): Promise<Listing[]> {
    return paginate(await this.sorted(query), query).map(clone)
  }

  async count(query: ListingQuery): Promise<number> {
    return [...this.items.values()].filter((l) => this.match(l, query)).length
  }

  async update(id: string, patch: Partial<Listing>): Promise<Listing> {
    const existing = this.items.get(id)
    if (!existing) throw err.notFound('Listing')
    const next = { ...existing, ...clone(patch), id: existing.id, updatedAt: new Date() }
    this.items.set(id, next)
    return clone(next)
  }

  async listForVersion(versionId: string): Promise<Listing[]> {
    return [...this.items.values()].filter((l) => l.versionId === versionId).map(clone)
  }

  clear(): void {
    this.items.clear()
  }
}

class MemoryOrderRepo implements OrderRepo {
  private readonly items = new Map<string, Order>()

  async create(order: Order): Promise<Order> {
    if (await this.getByMidtransOrderId(order.midtransOrderId)) {
      throw err.conflict('Duplicate Midtrans order id.')
    }
    this.items.set(order.id, clone(order))
    return clone(order)
  }

  async get(id: string): Promise<Order | null> {
    const found = this.items.get(id)
    return found ? clone(found) : null
  }

  async getByMidtransOrderId(midtransOrderId: string): Promise<Order | null> {
    for (const item of this.items.values()) {
      if (item.midtransOrderId === midtransOrderId) return clone(item)
    }
    return null
  }

  async listForBuyer(buyerId: string, page?: Page): Promise<Order[]> {
    const items = [...this.items.values()].filter((o) => o.buyerId === buyerId).sort(byNewest)
    return paginate(items, page).map(clone)
  }

  async listForSeller(sellerId: string, page?: Page): Promise<Order[]> {
    const items = [...this.items.values()].filter((o) => o.sellerId === sellerId).sort(byNewest)
    return paginate(items, page).map(clone)
  }

  async listDisputeWindowClosed(now: Date): Promise<Order[]> {
    return [...this.items.values()]
      .filter(
        (o) =>
          o.state === 'delivered' &&
          o.payoutMaturedAt === null &&
          o.disputeUntil !== null &&
          o.disputeUntil.getTime() <= now.getTime(),
      )
      .map(clone)
  }

  async listExpired(now: Date): Promise<Order[]> {
    return [...this.items.values()]
      .filter(
        (o) =>
          (o.state === 'created' || o.state === 'awaiting_payment') &&
          o.expiresAt.getTime() <= now.getTime(),
      )
      .map(clone)
  }

  async listStalledFulfilment(before: Date): Promise<Order[]> {
    return [...this.items.values()]
      .filter(
        (o) =>
          (o.state === 'paid' || o.state === 'fulfilling') &&
          o.updatedAt.getTime() <= before.getTime(),
      )
      .map(clone)
  }

  async compareAndSet(
    id: string,
    expected: OrderState,
    patch: Partial<Order> & { state: OrderState },
  ): Promise<Order | null> {
    const existing = this.items.get(id)
    if (!existing) throw err.notFound('Order')
    if (existing.state !== expected) return null
    const next = { ...existing, ...clone(patch), id: existing.id, updatedAt: new Date() }
    this.items.set(id, next)
    return clone(next)
  }

  async update(id: string, patch: Partial<Order>): Promise<Order> {
    if ('state' in patch) {
      throw new AppError(
        'internal',
        'Use compareAndSet to change an order state — update() is for non-state fields.',
      )
    }
    const existing = this.items.get(id)
    if (!existing) throw err.notFound('Order')
    const next = { ...existing, ...clone(patch), id: existing.id, updatedAt: new Date() }
    this.items.set(id, next)
    return clone(next)
  }

  async countForListing(listingId: string): Promise<number> {
    return [...this.items.values()].filter(
      (o) => o.listingId === listingId && o.state === 'delivered',
    ).length
  }

  clear(): void {
    this.items.clear()
  }
}

class MemoryDeliveryRepo implements DeliveryRepo {
  private readonly items = new Map<string, Delivery>()

  async create(delivery: Delivery): Promise<Delivery> {
    this.items.set(delivery.id, clone(delivery))
    return clone(delivery)
  }

  async get(id: string): Promise<Delivery | null> {
    const found = this.items.get(id)
    return found ? clone(found) : null
  }

  async getByOrder(orderId: string): Promise<Delivery | null> {
    for (const item of this.items.values()) {
      if (item.orderId === orderId) return clone(item)
    }
    return null
  }

  async update(id: string, patch: Partial<Delivery>): Promise<Delivery> {
    const existing = this.items.get(id)
    if (!existing) throw err.notFound('Delivery')
    const next = { ...existing, ...clone(patch), id: existing.id }
    this.items.set(id, next)
    return clone(next)
  }

  async consumeDownload(id: string): Promise<Delivery | null> {
    const existing = this.items.get(id)
    if (!existing) throw err.notFound('Delivery')
    if (existing.downloadCount >= existing.maxDownloads) return null
    const next = { ...existing, downloadCount: existing.downloadCount + 1 }
    this.items.set(id, next)
    return clone(next)
  }

  clear(): void {
    this.items.clear()
  }
}

class MemoryReviewRepo implements ReviewRepo {
  private readonly items = new Map<string, Review>()

  async create(review: Review): Promise<Review> {
    if (await this.getByOrder(review.orderId)) {
      throw err.conflict('This order has already been reviewed.')
    }
    this.items.set(review.id, clone(review))
    return clone(review)
  }

  async getByOrder(orderId: string): Promise<Review | null> {
    for (const item of this.items.values()) {
      if (item.orderId === orderId) return clone(item)
    }
    return null
  }

  async listForListing(listingId: string, page?: Page): Promise<Review[]> {
    const items = [...this.items.values()].filter((r) => r.listingId === listingId).sort(byNewest)
    return paginate(items, page).map(clone)
  }

  async listForChallenge(challengeId: string): Promise<Review[]> {
    return [...this.items.values()]
      .filter((r) => r.challengeId === challengeId)
      .sort(byNewest)
      .map(clone)
  }

  async summary(challengeId: string): Promise<{ count: number; average: number }> {
    const reviews = [...this.items.values()].filter((r) => r.challengeId === challengeId)
    if (reviews.length === 0) return { count: 0, average: 0 }
    const total = reviews.reduce((sum, r) => sum + r.rating, 0)
    return { count: reviews.length, average: total / reviews.length }
  }

  clear(): void {
    this.items.clear()
  }
}

class MemoryPayoutRepo implements PayoutRepo {
  private readonly balances = new Map<string, PayoutBalance>()
  private readonly releases = new Map<string, PayoutRelease>()

  private ensure(sellerId: string): PayoutBalance {
    let balance = this.balances.get(sellerId)
    if (!balance) {
      balance = { sellerId, pending: ZERO, payable: ZERO, paid: ZERO, updatedAt: new Date() }
      this.balances.set(sellerId, balance)
    }
    return balance
  }

  async getBalance(sellerId: string): Promise<PayoutBalance> {
    return clone(this.ensure(sellerId))
  }

  async accruePending(sellerId: string, amount: number, at: Date): Promise<PayoutBalance> {
    const balance = this.ensure(sellerId)
    const next: PayoutBalance = {
      ...balance,
      pending: rupiah(balance.pending + amount),
      updatedAt: at,
    }
    this.balances.set(sellerId, next)
    return clone(next)
  }

  async maturePending(sellerId: string, amount: number, at: Date): Promise<PayoutBalance> {
    const balance = this.ensure(sellerId)
    if (balance.pending < amount) {
      throw new AppError('internal', 'Cannot mature more than is pending.')
    }
    const next: PayoutBalance = {
      ...balance,
      pending: rupiah(balance.pending - amount),
      payable: rupiah(balance.payable + amount),
      updatedAt: at,
    }
    this.balances.set(sellerId, next)
    return clone(next)
  }

  async reversePending(sellerId: string, amount: number, at: Date): Promise<PayoutBalance> {
    const balance = this.ensure(sellerId)
    if (balance.pending < amount) {
      throw new AppError('internal', 'Cannot reverse more than is pending.')
    }
    const next: PayoutBalance = {
      ...balance,
      pending: rupiah(balance.pending - amount),
      updatedAt: at,
    }
    this.balances.set(sellerId, next)
    return clone(next)
  }

  async release(release: PayoutRelease): Promise<PayoutBalance> {
    const balance = this.ensure(release.sellerId)
    if (balance.payable < release.amount) {
      throw new AppError('internal', 'Cannot release more than is payable.')
    }
    const next: PayoutBalance = {
      ...balance,
      payable: rupiah(balance.payable - release.amount) as Rupiah,
      paid: rupiah(balance.paid + release.amount) as Rupiah,
      updatedAt: release.createdAt,
    }
    this.balances.set(release.sellerId, next)
    this.releases.set(release.id, clone(release))
    return clone(next)
  }

  async listReleases(sellerId: string): Promise<PayoutRelease[]> {
    return [...this.releases.values()]
      .filter((r) => r.sellerId === sellerId)
      .sort(byNewest)
      .map(clone)
  }

  async listWithPayable(): Promise<PayoutBalance[]> {
    return [...this.balances.values()].filter((b) => b.payable > 0).map(clone)
  }

  clear(): void {
    this.balances.clear()
    this.releases.clear()
  }
}

class MemoryAuditRepo implements AuditRepo {
  private readonly items: AuditEntry[] = []

  async append(entry: AuditEntry): Promise<AuditEntry> {
    this.items.push(clone(entry))
    return clone(entry)
  }

  async list(
    filter: { subjectType?: string; subjectId?: string; actor?: string } & Page = {},
  ): Promise<AuditEntry[]> {
    const matched = this.items
      .filter((e) => !filter.subjectType || e.subjectType === filter.subjectType)
      .filter((e) => !filter.subjectId || e.subjectId === filter.subjectId)
      .filter((e) => !filter.actor || e.actor === filter.actor)
      .sort(byNewest)
    return paginate(matched, filter).map(clone)
  }

  clear(): void {
    this.items.length = 0
  }
}

export class MemoryStore implements Store {
  readonly kind = 'memory' as const

  readonly users = new MemoryUserRepo()
  readonly challenges = new MemoryChallengeRepo()
  readonly versions = new MemoryVersionRepo()
  readonly verifications = new MemoryVerificationRepo()
  readonly reviews = new MemoryReviewRepo()
  readonly listings = new MemoryListingRepo(this.reviews)
  readonly orders = new MemoryOrderRepo()
  readonly deliveries = new MemoryDeliveryRepo()
  readonly payouts = new MemoryPayoutRepo()
  readonly audit = new MemoryAuditRepo()

  async reset(): Promise<void> {
    this.users.clear()
    this.challenges.clear()
    this.versions.clear()
    this.verifications.clear()
    this.listings.clear()
    this.orders.clear()
    this.deliveries.clear()
    this.reviews.clear()
    this.payouts.clear()
    this.audit.clear()
  }
}

/** Convenience for constructing an audit entry with an id and timestamp. */
export function auditEntry(
  actor: string,
  action: string,
  subjectType: string,
  subjectId: string,
  detail: Record<string, unknown> = {},
): AuditEntry {
  return {
    id: newId('audit'),
    actor,
    action,
    subjectType,
    subjectId,
    detail,
    createdAt: new Date(),
  }
}
