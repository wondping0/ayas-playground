import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { newId } from '@/lib/core/ids'
import { rupiah } from '@/lib/core/money'
import { snapshotLicense } from '@/lib/core/license'
import type { Listing, Order, User } from '@/lib/core/types'
import { MemoryStore, PostgresStore } from '@/lib/store'
import type { Store } from '@/lib/store/types'
import { buildManifest } from '@/lib/core/manifest'
import { parseChallengeYaml } from '@/lib/core/bundle'
import { goodBundleYaml } from './helpers/zip'

/**
 * One suite, both stores.
 *
 * The in-memory store is the default and the one every other test runs
 * against, so it is the one whose behaviour is proven. This file exists to
 * prove Postgres behaves the *same* — otherwise the tests describe development
 * and production is untested.
 *
 * The Postgres half is skipped unless DATABASE_URL is set:
 *
 *   docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=aya \
 *     -e POSTGRES_DB=aya_test --name aya-pg postgres:16-alpine
 *   DATABASE_URL=postgres://postgres:aya@localhost:5433/aya_test npm test
 *
 * **This suite TRUNCATES the database it is pointed at**, before every test.
 * `PostgresStore.reset()` refuses a database whose name does not contain
 * "test", which is the only thing standing between this and somebody's
 * development data. Use a database dedicated to tests — not the one you seeded.
 */

const SPEC = parseChallengeYaml(goodBundleYaml('generate'))
const MANIFEST = buildManifest([
  { path: 'challenge.yml', size: 10, sha256: 'a'.repeat(64) },
  { path: 'release_files/output.txt', size: 20, sha256: 'b'.repeat(64) },
])

function user(overrides: Partial<User> = {}): User {
  return {
    id: newId('user'),
    email: `${newId('user')}@aya.test`,
    name: 'Person',
    passwordHash: 'scrypt$x$y',
    roles: ['buyer'],
    createdAt: new Date(),
    ...overrides,
  }
}

async function seedListing(store: Store): Promise<{ seller: User; listing: Listing }> {
  const seller = await store.users.create(user({ roles: ['buyer', 'seller'] }))
  const challenge = await store.challenges.create({
    id: newId('challenge'),
    sellerId: seller.id,
    title: 'Shared Primes',
    slug: newId('challenge').toLowerCase(),
    category: 'crypto',
    currentVersionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const version = await store.versions.create({
    id: newId('version'),
    challengeId: challenge.id,
    ordinal: await store.versions.nextOrdinal(challenge.id),
    bundleHash: 'hash-1',
    manifest: MANIFEST,
    spec: SPEC,
    storageKey: 'k.zip',
    createdAt: new Date(),
  })
  const listing = await store.listings.create({
    id: newId('listing'),
    challengeId: challenge.id,
    versionId: version.id,
    sellerId: seller.id,
    title: 'Shared Primes',
    slug: newId('listing').toLowerCase(),
    summary: 'Two moduli.',
    schemes: ['rsa-weakness'],
    difficulty: 'easy',
    price: rupiah(150_000),
    licenseType: 'event',
    state: 'published',
    rejectionReason: null,
    publishedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return { seller, listing }
}

async function seedOrder(
  store: Store,
  listing: Listing,
  buyer: User,
  state: Order['state'] = 'created',
): Promise<Order> {
  const id = newId('order')
  return store.orders.create({
    id,
    midtransOrderId: `AYA-${id}`,
    buyerId: buyer.id,
    sellerId: listing.sellerId,
    listingId: listing.id,
    versionId: listing.versionId,
    amount: rupiah(150_000),
    commission: rupiah(15_000),
    sellerNet: rupiah(135_000),
    licenseTerms: snapshotLicense('event'),
    flagFormat: 'ayactf{%s}',
    state,
    snapToken: null,
    snapRedirectUrl: null,
    paymentType: null,
    failureReason: null,
    fulfillAttempts: 0,
    expiresAt: new Date(Date.now() + 3_600_000),
    paidAt: null,
    deliveredAt: null,
    disputeUntil: null,
    payoutMaturedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

const DATABASE_URL = process.env.DATABASE_URL

const IMPLEMENTATIONS: Array<{ name: string; make: () => Promise<Store>; skip: boolean }> = [
  { name: 'memory', make: async () => new MemoryStore(), skip: false },
  {
    name: 'postgres',
    make: async () => {
      const store = new PostgresStore(DATABASE_URL!)
      await store.migrate()
      return store
    },
    skip: !DATABASE_URL,
  },
]

for (const implementation of IMPLEMENTATIONS) {
  const suite = implementation.skip ? describe.skip : describe

  suite(`store contract — ${implementation.name}`, () => {
    let store: Store

    beforeEach(async () => {
      store ??= await implementation.make()
      await store.reset()
    })

    afterAll(async () => {
      if (store && 'close' in store) await (store as PostgresStore).close()
    })

    describe('users', () => {
      it('round-trips, and finds by email case-insensitively', async () => {
        const created = await store.users.create(user({ email: 'Someone@Aya.test' }))
        expect((await store.users.get(created.id))?.name).toBe('Person')
        expect((await store.users.getByEmail('someone@aya.TEST'))?.id).toBe(created.id)
      })

      it('refuses a duplicate email', async () => {
        await store.users.create(user({ email: 'dup@aya.test' }))
        await expect(store.users.create(user({ email: 'DUP@aya.test' }))).rejects.toThrow()
      })

      it('counts', async () => {
        expect(await store.users.count()).toBe(0)
        await store.users.create(user())
        expect(await store.users.count()).toBe(1)
      })

      it('updates roles', async () => {
        const created = await store.users.create(user())
        const updated = await store.users.update(created.id, { roles: ['buyer', 'admin'] })
        expect(updated.roles).toEqual(['buyer', 'admin'])
      })
    })

    describe('versions and verifications', () => {
      it('increments ordinals per challenge', async () => {
        const { listing } = await seedListing(store)
        const challengeId = listing.challengeId
        expect(await store.versions.nextOrdinal(challengeId)).toBe(2)
      })

      it('returns a passing verdict only for a matching hash', async () => {
        const { listing } = await seedListing(store)
        await store.verifications.create({
          id: newId('verification'),
          versionId: listing.versionId,
          bundleHash: 'hash-1',
          verdict: 'passed',
          runnerKind: 'docker',
          profile: 'python-crypto',
          durationMs: 100,
          log: '',
          message: 'ok',
          createdAt: new Date(),
        })

        expect(await store.verifications.passingForHash(listing.versionId, 'hash-1')).not.toBeNull()
        // A changed bundle must not inherit the old badge.
        expect(await store.verifications.passingForHash(listing.versionId, 'hash-2')).toBeNull()
      })

      it('ignores a failing verdict', async () => {
        const { listing } = await seedListing(store)
        await store.verifications.create({
          id: newId('verification'),
          versionId: listing.versionId,
          bundleHash: 'hash-1',
          verdict: 'failed',
          runnerKind: 'docker',
          profile: 'python-crypto',
          durationMs: 1,
          log: '',
          message: 'no',
          createdAt: new Date(),
        })
        expect(await store.verifications.passingForHash(listing.versionId, 'hash-1')).toBeNull()
      })
    })

    describe('listings', () => {
      it('filters by scheme, difficulty, price, and text', async () => {
        const { listing } = await seedListing(store)

        expect(await store.listings.query({ schemes: ['rsa-weakness'] })).toHaveLength(1)
        expect(await store.listings.query({ schemes: ['lattice'] })).toHaveLength(0)
        expect(await store.listings.query({ difficulty: 'easy' })).toHaveLength(1)
        expect(await store.listings.query({ difficulty: 'insane' })).toHaveLength(0)
        expect(await store.listings.query({ maxPrice: 200_000 })).toHaveLength(1)
        expect(await store.listings.query({ maxPrice: 100_000 })).toHaveLength(0)
        expect(await store.listings.query({ search: 'moduli' })).toHaveLength(1)
        expect(await store.listings.query({ search: 'nothing here' })).toHaveLength(0)
        expect(await store.listings.count({ state: 'published' })).toBe(1)
        expect(listing.state).toBe('published')
      })

      it('can clear a nullable field', async () => {
        // COALESCE-based updates silently cannot do this, which would leave a
        // listing unable to be un-rejected or unpublished.
        const { listing } = await seedListing(store)
        await store.listings.update(listing.id, {
          state: 'delisted',
          rejectionReason: 'nope',
        })
        const cleared = await store.listings.update(listing.id, {
          state: 'published',
          rejectionReason: null,
          publishedAt: null,
        })
        expect(cleared.rejectionReason).toBeNull()
        expect(cleared.publishedAt).toBeNull()
      })

      it('sorts by price', async () => {
        await seedListing(store)
        const second = await seedListing(store)
        await store.listings.update(second.listing.id, { price: rupiah(10_000) })

        const asc = await store.listings.query({ sort: 'price-asc' })
        expect(asc[0]?.price).toBe(10_000)
        const desc = await store.listings.query({ sort: 'price-desc' })
        expect(desc[0]?.price).toBe(150_000)
      })
    })

    describe('orders', () => {
      it('is atomic on compareAndSet', async () => {
        const { listing } = await seedListing(store)
        const buyer = await store.users.create(user())
        const order = await seedOrder(store, listing, buyer, 'awaiting_payment')

        const first = await store.orders.compareAndSet(order.id, 'awaiting_payment', {
          state: 'paid',
          paidAt: new Date(),
        })
        // The second caller — a duplicated webhook — sees the state has moved.
        const second = await store.orders.compareAndSet(order.id, 'awaiting_payment', {
          state: 'paid',
        })

        expect(first?.state).toBe('paid')
        expect(second).toBeNull()
      })

      it('refuses to change state through update()', async () => {
        const { listing } = await seedListing(store)
        const buyer = await store.users.create(user())
        const order = await seedOrder(store, listing, buyer)
        await expect(
          store.orders.update(order.id, { state: 'paid' } as Partial<Order>),
        ).rejects.toThrow(/compareAndSet/)
      })

      it('finds by Midtrans id and refuses a duplicate', async () => {
        const { listing } = await seedListing(store)
        const buyer = await store.users.create(user())
        const order = await seedOrder(store, listing, buyer)

        expect((await store.orders.getByMidtransOrderId(order.midtransOrderId))?.id).toBe(order.id)
      })

      it('lists expired, stalled, and dispute-closed orders', async () => {
        const { listing } = await seedListing(store)
        const buyer = await store.users.create(user())
        const order = await seedOrder(store, listing, buyer, 'awaiting_payment')

        const future = new Date(Date.now() + 7_200_000)
        expect((await store.orders.listExpired(future)).map((o) => o.id)).toContain(order.id)
        expect(await store.orders.listExpired(new Date(0))).toHaveLength(0)

        await store.orders.compareAndSet(order.id, 'awaiting_payment', { state: 'paid' })
        expect((await store.orders.listStalledFulfilment(future)).map((o) => o.id)).toContain(
          order.id,
        )
      })

      it('counts delivered orders for a listing', async () => {
        const { listing } = await seedListing(store)
        const buyer = await store.users.create(user())
        const order = await seedOrder(store, listing, buyer, 'fulfilling')
        expect(await store.orders.countForListing(listing.id)).toBe(0)
        await store.orders.compareAndSet(order.id, 'fulfilling', { state: 'delivered' })
        expect(await store.orders.countForListing(listing.id)).toBe(1)
      })
    })

    describe('deliveries', () => {
      it('consumes downloads atomically and stops at the cap', async () => {
        const { listing } = await seedListing(store)
        const buyer = await store.users.create(user())
        const order = await seedOrder(store, listing, buyer)

        const delivery = await store.deliveries.create({
          id: newId('delivery'),
          orderId: order.id,
          storageKey: 'a.zip',
          sizeBytes: 100,
          sha256: 'c'.repeat(64),
          downloadCount: 0,
          maxDownloads: 2,
          expiresAt: new Date(Date.now() + 86_400_000),
          createdAt: new Date(),
        })

        expect((await store.deliveries.consumeDownload(delivery.id))?.downloadCount).toBe(1)
        expect((await store.deliveries.consumeDownload(delivery.id))?.downloadCount).toBe(2)
        expect(await store.deliveries.consumeDownload(delivery.id)).toBeNull()
      })
    })

    describe('payouts', () => {
      it('moves money through pending, payable, and paid', async () => {
        const seller = await store.users.create(user())
        const admin = await store.users.create(user({ roles: ['admin'] }))
        const now = new Date()

        await store.payouts.accruePending(seller.id, 135_000, now)
        expect(await store.payouts.getBalance(seller.id)).toMatchObject({ pending: 135_000 })

        await store.payouts.maturePending(seller.id, 135_000, now)
        expect(await store.payouts.getBalance(seller.id)).toMatchObject({
          pending: 0,
          payable: 135_000,
        })

        await store.payouts.release({
          id: newId('payout'),
          sellerId: seller.id,
          amount: rupiah(135_000),
          reference: 'BCA-1',
          releasedBy: admin.id,
          createdAt: now,
        })
        expect(await store.payouts.getBalance(seller.id)).toMatchObject({
          payable: 0,
          paid: 135_000,
        })
        expect(await store.payouts.listReleases(seller.id)).toHaveLength(1)
      })

      it('refuses to move more than is held', async () => {
        const seller = await store.users.create(user())
        const admin = await store.users.create(user({ roles: ['admin'] }))
        const now = new Date()

        await store.payouts.accruePending(seller.id, 1_000, now)
        await expect(store.payouts.maturePending(seller.id, 2_000, now)).rejects.toThrow()
        await expect(store.payouts.reversePending(seller.id, 2_000, now)).rejects.toThrow()
        await expect(
          store.payouts.release({
            id: newId('payout'),
            sellerId: seller.id,
            amount: rupiah(2_000),
            reference: 'x',
            releasedBy: admin.id,
            createdAt: now,
          }),
        ).rejects.toThrow()
      })

      it('lists only sellers with something payable', async () => {
        const seller = await store.users.create(user())
        const now = new Date()
        expect(await store.payouts.listWithPayable()).toHaveLength(0)
        await store.payouts.accruePending(seller.id, 100, now)
        await store.payouts.maturePending(seller.id, 100, now)
        expect(await store.payouts.listWithPayable()).toHaveLength(1)
      })
    })

    describe('reviews', () => {
      it('is one per order, and averages per challenge', async () => {
        const { listing } = await seedListing(store)
        const buyer = await store.users.create(user())
        const order = await seedOrder(store, listing, buyer)

        await store.reviews.create({
          id: newId('review'),
          orderId: order.id,
          listingId: listing.id,
          challengeId: listing.challengeId,
          reviewerId: buyer.id,
          reviewerName: 'Buya',
          rating: 4,
          body: 'good',
          createdAt: new Date(),
        })

        await expect(
          store.reviews.create({
            id: newId('review'),
            orderId: order.id,
            listingId: listing.id,
            challengeId: listing.challengeId,
            reviewerId: buyer.id,
            reviewerName: 'Buya',
            rating: 1,
            body: 'again',
            createdAt: new Date(),
          }),
        ).rejects.toThrow()

        expect(await store.reviews.summary(listing.challengeId)).toEqual({ count: 1, average: 4 })
      })

      it('reports zero for a challenge with no reviews', async () => {
        const { listing } = await seedListing(store)
        expect(await store.reviews.summary(listing.challengeId)).toEqual({ count: 0, average: 0 })
      })
    })

    describe('audit', () => {
      it('appends and filters', async () => {
        await store.audit.append({
          id: newId('audit'),
          actor: 'system',
          action: 'order.paid',
          subjectType: 'order',
          subjectId: 'ord_1',
          detail: { reason: 'settlement' },
          createdAt: new Date(),
        })

        expect(await store.audit.list({ subjectType: 'order' })).toHaveLength(1)
        expect(await store.audit.list({ subjectId: 'ord_2' })).toHaveLength(0)
        expect(await store.audit.list({ actor: 'system' })).toHaveLength(1)

        const [entry] = await store.audit.list({})
        expect(entry?.detail).toEqual({ reason: 'settlement' })
      })
    })
  })
}
