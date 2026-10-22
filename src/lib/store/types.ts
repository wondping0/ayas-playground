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

export interface Page {
  limit?: number
  offset?: number
}

export interface ListingQuery extends Page {
  state?: Listing['state']
  sellerId?: string
  schemes?: string[]
  difficulty?: Listing['difficulty']
  /** Case-insensitive substring over title and summary. */
  search?: string
  maxPrice?: number
  sort?: 'newest' | 'price-asc' | 'price-desc' | 'rating'
}

export interface UserRepo {
  create(user: User): Promise<User>
  get(id: string): Promise<User | null>
  getByEmail(email: string): Promise<User | null>
  update(id: string, patch: Partial<User>): Promise<User>
  count(): Promise<number>
}

export interface ChallengeRepo {
  create(challenge: Challenge): Promise<Challenge>
  get(id: string): Promise<Challenge | null>
  getBySlug(slug: string): Promise<Challenge | null>
  listForSeller(sellerId: string, page?: Page): Promise<Challenge[]>
  update(id: string, patch: Partial<Challenge>): Promise<Challenge>
}

export interface VersionRepo {
  create(version: ChallengeVersion): Promise<ChallengeVersion>
  get(id: string): Promise<ChallengeVersion | null>
  listForChallenge(challengeId: string): Promise<ChallengeVersion[]>
  nextOrdinal(challengeId: string): Promise<number>
}

export interface VerificationRepo {
  create(verification: Verification): Promise<Verification>
  get(id: string): Promise<Verification | null>
  listForVersion(versionId: string): Promise<Verification[]>
  /** Most recent verdict for a version, whatever it was. */
  latestForVersion(versionId: string): Promise<Verification | null>
  /**
   * The passing verdict that still matches `bundleHash`, if any.
   *
   * Publishing reads this and nothing else — that is what makes the badge
   * unable to drift from what it verified.
   */
  passingForHash(versionId: string, bundleHash: string): Promise<Verification | null>
}

export interface ListingRepo {
  create(listing: Listing): Promise<Listing>
  get(id: string): Promise<Listing | null>
  getBySlug(slug: string): Promise<Listing | null>
  query(query: ListingQuery): Promise<Listing[]>
  count(query: ListingQuery): Promise<number>
  update(id: string, patch: Partial<Listing>): Promise<Listing>
  listForVersion(versionId: string): Promise<Listing[]>
}

export interface OrderRepo {
  create(order: Order): Promise<Order>
  get(id: string): Promise<Order | null>
  getByMidtransOrderId(midtransOrderId: string): Promise<Order | null>
  listForBuyer(buyerId: string, page?: Page): Promise<Order[]>
  listForSeller(sellerId: string, page?: Page): Promise<Order[]>
  /** Orders whose dispute window has closed but whose funds are still pending. */
  listDisputeWindowClosed(now: Date): Promise<Order[]>
  /** Unpaid orders past their TTL. */
  listExpired(now: Date): Promise<Order[]>
  /**
   * Paid orders that have not moved for a while.
   *
   * The fulfilment queue is in-process and non-durable, so a restart between
   * `paid` and `delivered` loses the job. Without this query the order sits in
   * `paid` forever with the buyer's money and nobody watching it.
   */
  listStalledFulfilment(before: Date): Promise<Order[]>
  /**
   * Compare-and-set on `state`.
   *
   * Returns null when the current state is not `expected`, which is what makes
   * a duplicated webhook a no-op instead of a double transition. Maps directly
   * to `UPDATE orders SET ... WHERE id = $1 AND state = $2` in Postgres.
   */
  compareAndSet(
    id: string,
    expected: OrderState,
    patch: Partial<Order> & { state: OrderState },
  ): Promise<Order | null>
  /** Non-state fields only. Throws if used to change `state`. */
  update(id: string, patch: Partial<Order>): Promise<Order>
  countForListing(listingId: string): Promise<number>
}

export interface DeliveryRepo {
  create(delivery: Delivery): Promise<Delivery>
  get(id: string): Promise<Delivery | null>
  getByOrder(orderId: string): Promise<Delivery | null>
  update(id: string, patch: Partial<Delivery>): Promise<Delivery>
  /** Atomic increment; returns null when the cap is already reached. */
  consumeDownload(id: string): Promise<Delivery | null>
}

export interface ReviewRepo {
  create(review: Review): Promise<Review>
  getByOrder(orderId: string): Promise<Review | null>
  listForListing(listingId: string, page?: Page): Promise<Review[]>
  listForChallenge(challengeId: string): Promise<Review[]>
  summary(challengeId: string): Promise<{ count: number; average: number }>
}

export interface PayoutRepo {
  getBalance(sellerId: string): Promise<PayoutBalance>
  /** Adds to `pending`. */
  accruePending(sellerId: string, amount: number, at: Date): Promise<PayoutBalance>
  /** Moves `pending` -> `payable`. */
  maturePending(sellerId: string, amount: number, at: Date): Promise<PayoutBalance>
  /** Reverses an accrual when an order is refunded. */
  reversePending(sellerId: string, amount: number, at: Date): Promise<PayoutBalance>
  /** Moves `payable` -> `paid` and records the release. */
  release(release: PayoutRelease): Promise<PayoutBalance>
  listReleases(sellerId: string): Promise<PayoutRelease[]>
  listWithPayable(): Promise<PayoutBalance[]>
}

export interface AuditRepo {
  append(entry: AuditEntry): Promise<AuditEntry>
  list(filter?: { subjectType?: string; subjectId?: string; actor?: string } & Page): Promise<
    AuditEntry[]
  >
}

export interface Store {
  readonly kind: 'memory' | 'postgres'
  users: UserRepo
  challenges: ChallengeRepo
  versions: VersionRepo
  verifications: VerificationRepo
  listings: ListingRepo
  orders: OrderRepo
  deliveries: DeliveryRepo
  reviews: ReviewRepo
  payouts: PayoutRepo
  audit: AuditRepo
  /** Test-only. Throws on a Postgres store. */
  reset(): Promise<void>
}
