import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'
import { AppError, err } from '@/lib/core/errors'
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
 * The Postgres store.
 *
 * The interface is the same one the in-memory store implements, so the
 * behaviour a test proves against memory is the behaviour production gets —
 * with two exceptions that only a database can provide, and which are the
 * reason this exists:
 *
 * - `compareAndSet` becomes `UPDATE ... WHERE id = $1 AND state = $2`, which is
 *   atomic across processes. A duplicated Midtrans webhook handled by two
 *   workers cannot double-transition an order.
 * - `consumeDownload` and the payout arithmetic are single statements, so two
 *   concurrent requests cannot both see the old value.
 */

// `BIGINT` arrives as a string by default. Every money value in this schema is
// well inside the safe-integer range, and a string would silently poison the
// arithmetic in money.ts.
pg.types.setTypeParser(20, (value: string) => Number.parseInt(value, 10))

type Row = Record<string, unknown>

function money(value: unknown): Rupiah {
  return rupiah(Number(value))
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value))
}

function optionalDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : date(value)
}

// --- Row mappers ------------------------------------------------------------

function toUser(row: Row): User {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    passwordHash: row.password_hash as string,
    roles: row.roles as User['roles'],
    createdAt: date(row.created_at),
  }
}

function toChallenge(row: Row): Challenge {
  return {
    id: row.id as string,
    sellerId: row.seller_id as string,
    title: row.title as string,
    slug: row.slug as string,
    category: row.category as string,
    currentVersionId: (row.current_version_id as string | null) ?? null,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  }
}

function toVersion(row: Row): ChallengeVersion {
  return {
    id: row.id as string,
    challengeId: row.challenge_id as string,
    ordinal: Number(row.ordinal),
    bundleHash: row.bundle_hash as string,
    manifest: row.manifest as ChallengeVersion['manifest'],
    spec: row.spec as ChallengeVersion['spec'],
    storageKey: row.storage_key as string,
    createdAt: date(row.created_at),
  }
}

function toVerification(row: Row): Verification {
  return {
    id: row.id as string,
    versionId: row.version_id as string,
    bundleHash: row.bundle_hash as string,
    verdict: row.verdict as Verification['verdict'],
    runnerKind: row.runner_kind as Verification['runnerKind'],
    profile: row.profile as Verification['profile'],
    durationMs: Number(row.duration_ms),
    log: row.log as string,
    message: row.message as string,
    createdAt: date(row.created_at),
  }
}

function toListing(row: Row): Listing {
  return {
    id: row.id as string,
    challengeId: row.challenge_id as string,
    versionId: row.version_id as string,
    sellerId: row.seller_id as string,
    title: row.title as string,
    slug: row.slug as string,
    summary: row.summary as string,
    schemes: row.schemes as string[],
    difficulty: row.difficulty as Listing['difficulty'],
    price: money(row.price),
    licenseType: row.license_type as Listing['licenseType'],
    state: row.state as Listing['state'],
    rejectionReason: (row.rejection_reason as string | null) ?? null,
    publishedAt: optionalDate(row.published_at),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  }
}

function toOrder(row: Row): Order {
  return {
    id: row.id as string,
    midtransOrderId: row.midtrans_order_id as string,
    buyerId: row.buyer_id as string,
    sellerId: row.seller_id as string,
    listingId: row.listing_id as string,
    versionId: row.version_id as string,
    amount: money(row.amount),
    commission: money(row.commission),
    sellerNet: money(row.seller_net),
    licenseTerms: row.license_terms as Order['licenseTerms'],
    flagFormat: row.flag_format as string,
    state: row.state as OrderState,
    snapToken: (row.snap_token as string | null) ?? null,
    snapRedirectUrl: (row.snap_redirect_url as string | null) ?? null,
    paymentType: (row.payment_type as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    fulfillAttempts: Number(row.fulfill_attempts),
    expiresAt: date(row.expires_at),
    paidAt: optionalDate(row.paid_at),
    deliveredAt: optionalDate(row.delivered_at),
    disputeUntil: optionalDate(row.dispute_until),
    payoutMaturedAt: optionalDate(row.payout_matured_at),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  }
}

function toDelivery(row: Row): Delivery {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    storageKey: row.storage_key as string,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256 as string,
    downloadCount: Number(row.download_count),
    maxDownloads: Number(row.max_downloads),
    expiresAt: date(row.expires_at),
    createdAt: date(row.created_at),
  }
}

function toReview(row: Row): Review {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    listingId: row.listing_id as string,
    challengeId: row.challenge_id as string,
    reviewerId: row.reviewer_id as string,
    reviewerName: row.reviewer_name as string,
    rating: Number(row.rating),
    body: row.body as string,
    createdAt: date(row.created_at),
  }
}

function toBalance(row: Row): PayoutBalance {
  return {
    sellerId: row.seller_id as string,
    pending: money(row.pending),
    payable: money(row.payable),
    paid: money(row.paid),
    updatedAt: date(row.updated_at),
  }
}

function toRelease(row: Row): PayoutRelease {
  return {
    id: row.id as string,
    sellerId: row.seller_id as string,
    amount: money(row.amount),
    reference: row.reference as string,
    releasedBy: row.released_by as string,
    createdAt: date(row.created_at),
  }
}

function toAudit(row: Row): AuditEntry {
  return {
    id: row.id as string,
    actor: row.actor as string,
    action: row.action as string,
    subjectType: row.subject_type as string,
    subjectId: row.subject_id as string,
    detail: row.detail as Record<string, unknown>,
    createdAt: date(row.created_at),
  }
}

/** Turn a unique-violation into the same conflict the memory store raises. */
function rethrow(error: unknown, message: string): never {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if ((error as { code?: string }).code === '23505') throw err.conflict(message)
  }
  throw error
}

// --- Repositories -----------------------------------------------------------

class Db {
  constructor(readonly pool: pg.Pool) {}

  async rows(text: string, values: unknown[] = []): Promise<Row[]> {
    const result = await this.pool.query(text, values)
    return result.rows as Row[]
  }

  async row(text: string, values: unknown[] = []): Promise<Row | null> {
    const rows = await this.rows(text, values)
    return rows[0] ?? null
  }
}

class PgUserRepo implements UserRepo {
  constructor(private readonly db: Db) {}

  async create(user: User): Promise<User> {
    try {
      const row = await this.db.row(
        `INSERT INTO users (id, email, name, password_hash, roles, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [user.id, user.email, user.name, user.passwordHash, user.roles, user.createdAt],
      )
      return toUser(row!)
    } catch (error) {
      rethrow(error, 'An account with that email already exists.')
    }
  }

  async get(id: string): Promise<User | null> {
    const row = await this.db.row('SELECT * FROM users WHERE id = $1', [id])
    return row ? toUser(row) : null
  }

  async getByEmail(email: string): Promise<User | null> {
    const row = await this.db.row('SELECT * FROM users WHERE lower(email) = lower($1)', [email])
    return row ? toUser(row) : null
  }

  async update(id: string, patch: Partial<User>): Promise<User> {
    const row = await this.db.row(
      `UPDATE users SET
         email         = COALESCE($2, email),
         name          = COALESCE($3, name),
         password_hash = COALESCE($4, password_hash),
         roles         = COALESCE($5, roles)
       WHERE id = $1 RETURNING *`,
      [id, patch.email ?? null, patch.name ?? null, patch.passwordHash ?? null, patch.roles ?? null],
    )
    if (!row) throw err.notFound('User')
    return toUser(row)
  }

  async count(): Promise<number> {
    const row = await this.db.row('SELECT count(*)::int AS n FROM users')
    return Number(row?.n ?? 0)
  }
}

class PgChallengeRepo implements ChallengeRepo {
  constructor(private readonly db: Db) {}

  async create(challenge: Challenge): Promise<Challenge> {
    try {
      const row = await this.db.row(
        `INSERT INTO challenges (id, seller_id, title, slug, category, current_version_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          challenge.id,
          challenge.sellerId,
          challenge.title,
          challenge.slug,
          challenge.category,
          challenge.currentVersionId,
          challenge.createdAt,
          challenge.updatedAt,
        ],
      )
      return toChallenge(row!)
    } catch (error) {
      rethrow(error, `A challenge with slug "${challenge.slug}" already exists.`)
    }
  }

  async get(id: string): Promise<Challenge | null> {
    const row = await this.db.row('SELECT * FROM challenges WHERE id = $1', [id])
    return row ? toChallenge(row) : null
  }

  async getBySlug(slug: string): Promise<Challenge | null> {
    const row = await this.db.row('SELECT * FROM challenges WHERE slug = $1', [slug])
    return row ? toChallenge(row) : null
  }

  async listForSeller(sellerId: string, page?: Page): Promise<Challenge[]> {
    const rows = await this.db.rows(
      `SELECT * FROM challenges WHERE seller_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [sellerId, page?.limit ?? 50, page?.offset ?? 0],
    )
    return rows.map(toChallenge)
  }

  async update(id: string, patch: Partial<Challenge>): Promise<Challenge> {
    const row = await this.db.row(
      `UPDATE challenges SET
         title              = COALESCE($2, title),
         category           = COALESCE($3, category),
         current_version_id = COALESCE($4, current_version_id),
         updated_at         = now()
       WHERE id = $1 RETURNING *`,
      [id, patch.title ?? null, patch.category ?? null, patch.currentVersionId ?? null],
    )
    if (!row) throw err.notFound('Challenge')
    return toChallenge(row)
  }
}

class PgVersionRepo implements VersionRepo {
  constructor(private readonly db: Db) {}

  async create(version: ChallengeVersion): Promise<ChallengeVersion> {
    const row = await this.db.row(
      `INSERT INTO challenge_versions
         (id, challenge_id, ordinal, bundle_hash, manifest, spec, storage_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        version.id,
        version.challengeId,
        version.ordinal,
        version.bundleHash,
        JSON.stringify(version.manifest),
        JSON.stringify(version.spec),
        version.storageKey,
        version.createdAt,
      ],
    )
    return toVersion(row!)
  }

  async get(id: string): Promise<ChallengeVersion | null> {
    const row = await this.db.row('SELECT * FROM challenge_versions WHERE id = $1', [id])
    return row ? toVersion(row) : null
  }

  async listForChallenge(challengeId: string): Promise<ChallengeVersion[]> {
    const rows = await this.db.rows(
      'SELECT * FROM challenge_versions WHERE challenge_id = $1 ORDER BY ordinal ASC',
      [challengeId],
    )
    return rows.map(toVersion)
  }

  async nextOrdinal(challengeId: string): Promise<number> {
    const row = await this.db.row(
      'SELECT COALESCE(max(ordinal), 0) + 1 AS next FROM challenge_versions WHERE challenge_id = $1',
      [challengeId],
    )
    return Number(row?.next ?? 1)
  }
}

class PgVerificationRepo implements VerificationRepo {
  constructor(private readonly db: Db) {}

  async create(verification: Verification): Promise<Verification> {
    const row = await this.db.row(
      `INSERT INTO verifications
         (id, version_id, bundle_hash, verdict, runner_kind, profile, duration_ms, log, message, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        verification.id,
        verification.versionId,
        verification.bundleHash,
        verification.verdict,
        verification.runnerKind,
        verification.profile,
        verification.durationMs,
        verification.log,
        verification.message,
        verification.createdAt,
      ],
    )
    return toVerification(row!)
  }

  async get(id: string): Promise<Verification | null> {
    const row = await this.db.row('SELECT * FROM verifications WHERE id = $1', [id])
    return row ? toVerification(row) : null
  }

  async listForVersion(versionId: string): Promise<Verification[]> {
    const rows = await this.db.rows(
      'SELECT * FROM verifications WHERE version_id = $1 ORDER BY created_at DESC',
      [versionId],
    )
    return rows.map(toVerification)
  }

  async latestForVersion(versionId: string): Promise<Verification | null> {
    const row = await this.db.row(
      'SELECT * FROM verifications WHERE version_id = $1 ORDER BY created_at DESC LIMIT 1',
      [versionId],
    )
    return row ? toVerification(row) : null
  }

  async passingForHash(versionId: string, bundleHash: string): Promise<Verification | null> {
    const row = await this.db.row(
      `SELECT * FROM verifications
       WHERE version_id = $1 AND bundle_hash = $2 AND verdict = 'passed'
       ORDER BY created_at DESC LIMIT 1`,
      [versionId, bundleHash],
    )
    return row ? toVerification(row) : null
  }
}

class PgListingRepo implements ListingRepo {
  constructor(private readonly db: Db) {}

  async create(listing: Listing): Promise<Listing> {
    try {
      const row = await this.db.row(
        `INSERT INTO listings
           (id, challenge_id, version_id, seller_id, title, slug, summary, schemes,
            difficulty, price, license_type, state, rejection_reason, published_at,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
          listing.id,
          listing.challengeId,
          listing.versionId,
          listing.sellerId,
          listing.title,
          listing.slug,
          listing.summary,
          listing.schemes,
          listing.difficulty,
          listing.price,
          listing.licenseType,
          listing.state,
          listing.rejectionReason,
          listing.publishedAt,
          listing.createdAt,
          listing.updatedAt,
        ],
      )
      return toListing(row!)
    } catch (error) {
      rethrow(error, `A listing with slug "${listing.slug}" already exists.`)
    }
  }

  async get(id: string): Promise<Listing | null> {
    const row = await this.db.row('SELECT * FROM listings WHERE id = $1', [id])
    return row ? toListing(row) : null
  }

  async getBySlug(slug: string): Promise<Listing | null> {
    const row = await this.db.row('SELECT * FROM listings WHERE slug = $1', [slug])
    return row ? toListing(row) : null
  }

  /** Shared WHERE for `query` and `count`, so the two can never disagree. */
  private where(query: ListingQuery): { sql: string; values: unknown[] } {
    const clauses: string[] = ['TRUE']
    const values: unknown[] = []
    const next = () => `$${values.length + 1}`

    if (query.state) {
      clauses.push(`l.state = ${next()}`)
      values.push(query.state)
    }
    if (query.sellerId) {
      clauses.push(`l.seller_id = ${next()}`)
      values.push(query.sellerId)
    }
    if (query.difficulty) {
      clauses.push(`l.difficulty = ${next()}`)
      values.push(query.difficulty)
    }
    if (query.maxPrice !== undefined) {
      clauses.push(`l.price <= ${next()}`)
      values.push(query.maxPrice)
    }
    if (query.schemes?.length) {
      clauses.push(`l.schemes && ${next()}`)
      values.push(query.schemes)
    }
    if (query.search) {
      clauses.push(`(l.title ILIKE ${next()} OR l.summary ILIKE $${values.length + 1})`)
      values.push(`%${query.search.trim()}%`)
    }

    return { sql: clauses.join(' AND '), values }
  }

  async query(query: ListingQuery): Promise<Listing[]> {
    const { sql, values } = this.where(query)

    const order =
      query.sort === 'price-asc'
        ? 'l.price ASC'
        : query.sort === 'price-desc'
          ? 'l.price DESC'
          : query.sort === 'rating'
            ? 'COALESCE(r.average, 0) DESC, l.created_at DESC'
            : 'l.created_at DESC'

    const rows = await this.db.rows(
      `SELECT l.* FROM listings l
       LEFT JOIN (
         SELECT challenge_id, avg(rating)::float AS average
         FROM reviews GROUP BY challenge_id
       ) r ON r.challenge_id = l.challenge_id
       WHERE ${sql}
       ORDER BY ${order}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.limit ?? 50, query.offset ?? 0],
    )
    return rows.map(toListing)
  }

  async count(query: ListingQuery): Promise<number> {
    const { sql, values } = this.where(query)
    const row = await this.db.row(
      `SELECT count(*)::int AS n FROM listings l WHERE ${sql}`,
      values,
    )
    return Number(row?.n ?? 0)
  }

  async update(id: string, patch: Partial<Listing>): Promise<Listing> {
    // Nullable columns take a "was this key in the patch?" flag rather than
    // COALESCE: a caller must be able to *clear* a rejection reason or
    // unpublish a listing, and COALESCE cannot express the difference between
    // "leave it" and "set it to null".
    const row = await this.db.row(
      `UPDATE listings SET
         version_id       = COALESCE($2, version_id),
         summary          = COALESCE($3, summary),
         schemes          = COALESCE($4, schemes),
         difficulty       = COALESCE($5, difficulty),
         price            = COALESCE($6, price),
         license_type     = COALESCE($7, license_type),
         state            = COALESCE($8, state),
         rejection_reason = CASE WHEN $9::boolean  THEN $10 ELSE rejection_reason END,
         published_at     = CASE WHEN $11::boolean THEN $12 ELSE published_at END,
         updated_at       = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        patch.versionId ?? null,
        patch.summary ?? null,
        patch.schemes ?? null,
        patch.difficulty ?? null,
        patch.price ?? null,
        patch.licenseType ?? null,
        patch.state ?? null,
        'rejectionReason' in patch,
        patch.rejectionReason ?? null,
        'publishedAt' in patch,
        patch.publishedAt ?? null,
      ],
    )
    if (!row) throw err.notFound('Listing')
    return toListing(row)
  }

  async listForVersion(versionId: string): Promise<Listing[]> {
    const rows = await this.db.rows('SELECT * FROM listings WHERE version_id = $1', [versionId])
    return rows.map(toListing)
  }
}

class PgOrderRepo implements OrderRepo {
  constructor(private readonly db: Db) {}

  async create(order: Order): Promise<Order> {
    try {
      const row = await this.db.row(
        `INSERT INTO orders
           (id, midtrans_order_id, buyer_id, seller_id, listing_id, version_id, amount,
            commission, seller_net, license_terms, flag_format, state, snap_token,
            snap_redirect_url, payment_type, failure_reason, fulfill_attempts, expires_at,
            paid_at, delivered_at, dispute_until, payout_matured_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING *`,
        [
          order.id,
          order.midtransOrderId,
          order.buyerId,
          order.sellerId,
          order.listingId,
          order.versionId,
          order.amount,
          order.commission,
          order.sellerNet,
          JSON.stringify(order.licenseTerms),
          order.flagFormat,
          order.state,
          order.snapToken,
          order.snapRedirectUrl,
          order.paymentType,
          order.failureReason,
          order.fulfillAttempts,
          order.expiresAt,
          order.paidAt,
          order.deliveredAt,
          order.disputeUntil,
          order.payoutMaturedAt,
          order.createdAt,
          order.updatedAt,
        ],
      )
      return toOrder(row!)
    } catch (error) {
      rethrow(error, 'Duplicate Midtrans order id.')
    }
  }

  async get(id: string): Promise<Order | null> {
    const row = await this.db.row('SELECT * FROM orders WHERE id = $1', [id])
    return row ? toOrder(row) : null
  }

  async getByMidtransOrderId(midtransOrderId: string): Promise<Order | null> {
    const row = await this.db.row('SELECT * FROM orders WHERE midtrans_order_id = $1', [
      midtransOrderId,
    ])
    return row ? toOrder(row) : null
  }

  async listForBuyer(buyerId: string, page?: Page): Promise<Order[]> {
    const rows = await this.db.rows(
      'SELECT * FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [buyerId, page?.limit ?? 50, page?.offset ?? 0],
    )
    return rows.map(toOrder)
  }

  async listForSeller(sellerId: string, page?: Page): Promise<Order[]> {
    const rows = await this.db.rows(
      'SELECT * FROM orders WHERE seller_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [sellerId, page?.limit ?? 50, page?.offset ?? 0],
    )
    return rows.map(toOrder)
  }

  async listDisputeWindowClosed(now: Date): Promise<Order[]> {
    const rows = await this.db.rows(
      `SELECT * FROM orders
       WHERE state = 'delivered' AND payout_matured_at IS NULL
         AND dispute_until IS NOT NULL AND dispute_until <= $1`,
      [now],
    )
    return rows.map(toOrder)
  }

  async listExpired(now: Date): Promise<Order[]> {
    const rows = await this.db.rows(
      `SELECT * FROM orders
       WHERE state IN ('created', 'awaiting_payment') AND expires_at <= $1`,
      [now],
    )
    return rows.map(toOrder)
  }

  async listStalledFulfilment(before: Date): Promise<Order[]> {
    const rows = await this.db.rows(
      `SELECT * FROM orders
       WHERE state IN ('paid', 'fulfilling') AND updated_at <= $1`,
      [before],
    )
    return rows.map(toOrder)
  }

  /**
   * Atomic across processes.
   *
   * The `AND state = $2` is what makes a duplicated webhook safe: whichever
   * worker gets there first changes the row, and the other's UPDATE matches
   * nothing and returns null.
   */
  async compareAndSet(
    id: string,
    expected: OrderState,
    patch: Partial<Order> & { state: OrderState },
  ): Promise<Order | null> {
    const exists = await this.db.row('SELECT 1 FROM orders WHERE id = $1', [id])
    if (!exists) throw err.notFound('Order')

    const row = await this.db.row(
      `UPDATE orders SET
         state             = $3,
         snap_token        = COALESCE($4, snap_token),
         snap_redirect_url = COALESCE($5, snap_redirect_url),
         payment_type      = COALESCE($6, payment_type),
         failure_reason    = CASE WHEN $7::boolean THEN $8 ELSE failure_reason END,
         fulfill_attempts  = COALESCE($9, fulfill_attempts),
         paid_at           = COALESCE($10, paid_at),
         delivered_at      = COALESCE($11, delivered_at),
         dispute_until     = COALESCE($12, dispute_until),
         payout_matured_at = COALESCE($13, payout_matured_at),
         updated_at        = now()
       WHERE id = $1 AND state = $2 RETURNING *`,
      [
        id,
        expected,
        patch.state,
        patch.snapToken ?? null,
        patch.snapRedirectUrl ?? null,
        patch.paymentType ?? null,
        'failureReason' in patch,
        patch.failureReason ?? null,
        patch.fulfillAttempts ?? null,
        patch.paidAt ?? null,
        patch.deliveredAt ?? null,
        patch.disputeUntil ?? null,
        patch.payoutMaturedAt ?? null,
      ],
    )
    return row ? toOrder(row) : null
  }

  async update(id: string, patch: Partial<Order>): Promise<Order> {
    if ('state' in patch) {
      throw new AppError(
        'internal',
        'Use compareAndSet to change an order state — update() is for non-state fields.',
      )
    }
    const row = await this.db.row(
      `UPDATE orders SET
         payment_type      = COALESCE($2, payment_type),
         failure_reason    = CASE WHEN $3::boolean THEN $4 ELSE failure_reason END,
         fulfill_attempts  = COALESCE($5, fulfill_attempts),
         payout_matured_at = COALESCE($6, payout_matured_at),
         updated_at        = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        patch.paymentType ?? null,
        'failureReason' in patch,
        patch.failureReason ?? null,
        patch.fulfillAttempts ?? null,
        patch.payoutMaturedAt ?? null,
      ],
    )
    if (!row) throw err.notFound('Order')
    return toOrder(row)
  }

  async countForListing(listingId: string): Promise<number> {
    const row = await this.db.row(
      `SELECT count(*)::int AS n FROM orders WHERE listing_id = $1 AND state = 'delivered'`,
      [listingId],
    )
    return Number(row?.n ?? 0)
  }
}

class PgDeliveryRepo implements DeliveryRepo {
  constructor(private readonly db: Db) {}

  async create(delivery: Delivery): Promise<Delivery> {
    const row = await this.db.row(
      `INSERT INTO deliveries
         (id, order_id, storage_key, size_bytes, sha256, download_count, max_downloads, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        delivery.id,
        delivery.orderId,
        delivery.storageKey,
        delivery.sizeBytes,
        delivery.sha256,
        delivery.downloadCount,
        delivery.maxDownloads,
        delivery.expiresAt,
        delivery.createdAt,
      ],
    )
    return toDelivery(row!)
  }

  async get(id: string): Promise<Delivery | null> {
    const row = await this.db.row('SELECT * FROM deliveries WHERE id = $1', [id])
    return row ? toDelivery(row) : null
  }

  async getByOrder(orderId: string): Promise<Delivery | null> {
    const row = await this.db.row('SELECT * FROM deliveries WHERE order_id = $1', [orderId])
    return row ? toDelivery(row) : null
  }

  async update(id: string, patch: Partial<Delivery>): Promise<Delivery> {
    const row = await this.db.row(
      `UPDATE deliveries SET
         download_count = COALESCE($2, download_count),
         max_downloads  = COALESCE($3, max_downloads),
         expires_at     = COALESCE($4, expires_at)
       WHERE id = $1 RETURNING *`,
      [id, patch.downloadCount ?? null, patch.maxDownloads ?? null, patch.expiresAt ?? null],
    )
    if (!row) throw err.notFound('Delivery')
    return toDelivery(row)
  }

  /** One statement, so two concurrent downloads cannot both take the last slot. */
  async consumeDownload(id: string): Promise<Delivery | null> {
    const exists = await this.db.row('SELECT 1 FROM deliveries WHERE id = $1', [id])
    if (!exists) throw err.notFound('Delivery')

    const row = await this.db.row(
      `UPDATE deliveries SET download_count = download_count + 1
       WHERE id = $1 AND download_count < max_downloads RETURNING *`,
      [id],
    )
    return row ? toDelivery(row) : null
  }
}

class PgReviewRepo implements ReviewRepo {
  constructor(private readonly db: Db) {}

  async create(review: Review): Promise<Review> {
    try {
      const row = await this.db.row(
        `INSERT INTO reviews
           (id, order_id, listing_id, challenge_id, reviewer_id, reviewer_name, rating, body, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          review.id,
          review.orderId,
          review.listingId,
          review.challengeId,
          review.reviewerId,
          review.reviewerName,
          review.rating,
          review.body,
          review.createdAt,
        ],
      )
      return toReview(row!)
    } catch (error) {
      rethrow(error, 'This order has already been reviewed.')
    }
  }

  async getByOrder(orderId: string): Promise<Review | null> {
    const row = await this.db.row('SELECT * FROM reviews WHERE order_id = $1', [orderId])
    return row ? toReview(row) : null
  }

  async listForListing(listingId: string, page?: Page): Promise<Review[]> {
    const rows = await this.db.rows(
      'SELECT * FROM reviews WHERE listing_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [listingId, page?.limit ?? 50, page?.offset ?? 0],
    )
    return rows.map(toReview)
  }

  async listForChallenge(challengeId: string): Promise<Review[]> {
    const rows = await this.db.rows(
      'SELECT * FROM reviews WHERE challenge_id = $1 ORDER BY created_at DESC',
      [challengeId],
    )
    return rows.map(toReview)
  }

  async summary(challengeId: string): Promise<{ count: number; average: number }> {
    const row = await this.db.row(
      `SELECT count(*)::int AS n, COALESCE(avg(rating), 0)::float AS average
       FROM reviews WHERE challenge_id = $1`,
      [challengeId],
    )
    return { count: Number(row?.n ?? 0), average: Number(row?.average ?? 0) }
  }
}

class PgPayoutRepo implements PayoutRepo {
  constructor(private readonly db: Db) {}

  private async ensure(sellerId: string): Promise<Row> {
    const row = await this.db.row(
      `INSERT INTO payout_balances (seller_id, pending, payable, paid, updated_at)
       VALUES ($1, 0, 0, 0, now())
       ON CONFLICT (seller_id) DO UPDATE SET seller_id = EXCLUDED.seller_id
       RETURNING *`,
      [sellerId],
    )
    return row!
  }

  async getBalance(sellerId: string): Promise<PayoutBalance> {
    return toBalance(await this.ensure(sellerId))
  }

  // Every mutation is `column = column ± $n` in a single statement, so two
  // concurrent deliveries cannot both read the same starting balance.
  async accruePending(sellerId: string, amount: number, at: Date): Promise<PayoutBalance> {
    await this.ensure(sellerId)
    const row = await this.db.row(
      `UPDATE payout_balances SET pending = pending + $2, updated_at = $3
       WHERE seller_id = $1 RETURNING *`,
      [sellerId, amount, at],
    )
    return toBalance(row!)
  }

  async maturePending(sellerId: string, amount: number, at: Date): Promise<PayoutBalance> {
    await this.ensure(sellerId)
    const row = await this.db.row(
      `UPDATE payout_balances SET pending = pending - $2, payable = payable + $2, updated_at = $3
       WHERE seller_id = $1 AND pending >= $2 RETURNING *`,
      [sellerId, amount, at],
    )
    if (!row) throw new AppError('internal', 'Cannot mature more than is pending.')
    return toBalance(row)
  }

  async reversePending(sellerId: string, amount: number, at: Date): Promise<PayoutBalance> {
    await this.ensure(sellerId)
    const row = await this.db.row(
      `UPDATE payout_balances SET pending = pending - $2, updated_at = $3
       WHERE seller_id = $1 AND pending >= $2 RETURNING *`,
      [sellerId, amount, at],
    )
    if (!row) throw new AppError('internal', 'Cannot reverse more than is pending.')
    return toBalance(row)
  }

  async release(release: PayoutRelease): Promise<PayoutBalance> {
    const client = await this.db.pool.connect()
    try {
      await client.query('BEGIN')
      const updated = await client.query(
        `UPDATE payout_balances SET payable = payable - $2, paid = paid + $2, updated_at = $3
         WHERE seller_id = $1 AND payable >= $2 RETURNING *`,
        [release.sellerId, release.amount, release.createdAt],
      )
      if (updated.rowCount === 0) {
        await client.query('ROLLBACK')
        throw new AppError('internal', 'Cannot release more than is payable.')
      }
      await client.query(
        `INSERT INTO payout_releases (id, seller_id, amount, reference, released_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          release.id,
          release.sellerId,
          release.amount,
          release.reference,
          release.releasedBy,
          release.createdAt,
        ],
      )
      await client.query('COMMIT')
      return toBalance(updated.rows[0] as Row)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async listReleases(sellerId: string): Promise<PayoutRelease[]> {
    const rows = await this.db.rows(
      'SELECT * FROM payout_releases WHERE seller_id = $1 ORDER BY created_at DESC',
      [sellerId],
    )
    return rows.map(toRelease)
  }

  async listWithPayable(): Promise<PayoutBalance[]> {
    const rows = await this.db.rows('SELECT * FROM payout_balances WHERE payable > 0')
    return rows.map(toBalance)
  }
}

class PgAuditRepo implements AuditRepo {
  constructor(private readonly db: Db) {}

  async append(entry: AuditEntry): Promise<AuditEntry> {
    const row = await this.db.row(
      `INSERT INTO audit_entries (id, actor, action, subject_type, subject_id, detail, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        entry.id,
        entry.actor,
        entry.action,
        entry.subjectType,
        entry.subjectId,
        JSON.stringify(entry.detail),
        entry.createdAt,
      ],
    )
    return toAudit(row!)
  }

  async list(
    filter: { subjectType?: string; subjectId?: string; actor?: string } & Page = {},
  ): Promise<AuditEntry[]> {
    const rows = await this.db.rows(
      `SELECT * FROM audit_entries
       WHERE ($1::text IS NULL OR subject_type = $1)
         AND ($2::text IS NULL OR subject_id = $2)
         AND ($3::text IS NULL OR actor = $3)
       ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
      [
        filter.subjectType ?? null,
        filter.subjectId ?? null,
        filter.actor ?? null,
        filter.limit ?? 50,
        filter.offset ?? 0,
      ],
    )
    return rows.map(toAudit)
  }
}

// --- The store ---------------------------------------------------------------

export class PostgresStore implements Store {
  readonly kind = 'postgres' as const

  private readonly pool: pg.Pool
  private readonly db: Db

  readonly users: UserRepo
  readonly challenges: ChallengeRepo
  readonly versions: VersionRepo
  readonly verifications: VerificationRepo
  readonly listings: ListingRepo
  readonly orders: OrderRepo
  readonly deliveries: DeliveryRepo
  readonly reviews: ReviewRepo
  readonly payouts: PayoutRepo
  readonly audit: AuditRepo

  constructor(connectionString: string, max = 10) {
    this.pool = new pg.Pool({ connectionString, max })
    this.db = new Db(this.pool)

    this.users = new PgUserRepo(this.db)
    this.challenges = new PgChallengeRepo(this.db)
    this.versions = new PgVersionRepo(this.db)
    this.verifications = new PgVerificationRepo(this.db)
    this.listings = new PgListingRepo(this.db)
    this.orders = new PgOrderRepo(this.db)
    this.deliveries = new PgDeliveryRepo(this.db)
    this.reviews = new PgReviewRepo(this.db)
    this.payouts = new PgPayoutRepo(this.db)
    this.audit = new PgAuditRepo(this.db)
  }

  /** Apply schema.sql. Idempotent, and safe to call on every boot. */
  async migrate(): Promise<void> {
    const sql = await readFile(join(process.cwd(), 'src/lib/store/schema.sql'), 'utf8')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Test-only. Truncates every table.
   *
   * Guarded on the connection string naming a test database, because the
   * in-memory store's `reset()` is harmless and this one is not — the shapes
   * being identical is exactly what makes an accidental call plausible.
   */
  async reset(): Promise<void> {
    const url = (this.pool.options as { connectionString?: string }).connectionString ?? ''
    if (!/test/i.test(url)) {
      throw new AppError(
        'internal',
        'reset() refuses to truncate a database whose name does not contain "test".',
      )
    }
    await this.pool.query(`TRUNCATE
      audit_entries, payout_releases, payout_balances, reviews, deliveries,
      orders, listings, verifications, challenge_versions, challenges, users
      RESTART IDENTITY CASCADE`)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
