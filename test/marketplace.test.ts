import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { browse, createListing, createReview, publishListing, submitBundle, verifyVersion } from '@/lib/catalog'
import {
  balanceFor,
  createOrder,
  handleNotification,
  issueDownloadLink,
  maturePayouts,
  notificationAmount,
  recoverStalledFulfilments,
  redeemDownload,
  refundOrder,
  registerCommerceJobs,
  releasePayout,
  signNotification,
} from '@/lib/commerce'
import { AppError } from '@/lib/core/errors'
import { deriveFlag } from '@/lib/core/flag'
import type { User } from '@/lib/core/types'
import { extractBundle, InProcessQueue, setQueue, setRunner, getQueue } from '@/lib/forge'
import { StubRunner } from '@/lib/forge/stub-runner'
import { register } from '@/lib/auth'
import { MemoryStore, getStore, setStore } from '@/lib/store'
import { FakeRunner, realisticRunner, runResult } from './helpers/fake-runner'
import { STATIC_FLAG, goodBundle } from './helpers/zip'

/**
 * The whole pipeline: submit -> verify -> publish -> order -> pay -> fulfil ->
 * deliver -> review -> payout.
 *
 * Every plane meets here, so this is where a boundary that only works in
 * isolation shows up.
 */

let dataDir: string
let queue: InProcessQueue

async function makeUsers(): Promise<{ admin: User; seller: User; buyer: User }> {
  // The first account registered becomes the administrator.
  const admin = await register({ email: 'admin@aya.test', password: 'correct-horse-battery', name: 'Admin' })
  const seller = await register({
    email: 'seller@aya.test',
    password: 'correct-horse-battery',
    name: 'Sella',
    roles: ['buyer', 'seller'],
  })
  const buyer = await register({ email: 'buyer@aya.test', password: 'correct-horse-battery', name: 'Buya' })
  return { admin, seller, buyer }
}

async function listedChallenge(seller: User, price = 150_000) {
  const { version } = await submitBundle({ seller, data: goodBundle() })
  await verifyVersion(version.id, seller.id)
  const listing = await createListing({
    seller,
    versionId: version.id,
    price,
    licenseType: 'event',
    summary: 'Two moduli, one careless prime.',
  })
  return { version, listing: await publishListing(listing.id, seller.id) }
}

async function payFor(order: { midtransOrderId: string; amount: number }, status = 'settlement') {
  return handleNotification(
    signNotification({
      order_id: order.midtransOrderId,
      status_code: '200',
      gross_amount: notificationAmount(order.amount as never),
      transaction_status: status,
      payment_type: 'qris',
    }),
  )
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'aya-e2e-'))
  process.env.AYA_DATA_DIR = dataDir
  setStore(new MemoryStore())
  setRunner(realisticRunner())
  queue = new InProcessQueue(2)
  setQueue(queue)
  registerCommerceJobs()
})

afterEach(async () => {
  setQueue(null)
  setStore(null)
  setRunner(null)
  delete process.env.AYA_DATA_DIR
  await rm(dataDir, { recursive: true, force: true })
})

describe('the happy path', () => {
  it('carries a challenge from upload to a delivered, downloadable bundle', async () => {
    const { seller, buyer } = await makeUsers()
    const { version, listing } = await listedChallenge(seller)

    expect(listing.state).toBe('published')

    const shelf = await browse()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]?.verified).not.toBeNull()
    expect(shelf[0]?.priceLabel).toBe('Rp 150.000')

    const order = await createOrder({ buyer, listing })
    expect(order.state).toBe('awaiting_payment')
    expect(order.snapToken).toBeTruthy()
    // 10% commission by default.
    expect(order.commission).toBe(15_000)
    expect(order.sellerNet).toBe(135_000)

    const outcome = await payFor(order)
    expect(outcome.applied).toBe(true)
    expect(outcome.state).toBe('paid')

    await queue.drain()

    const delivered = await getStore().orders.get(order.id)
    expect(delivered?.state).toBe('delivered')
    expect(delivered?.disputeUntil).toBeInstanceOf(Date)

    const link = await issueDownloadLink(order.id, buyer)
    expect(link.remaining).toBe(10)

    const payload = await redeemDownload(link.token, buyer)
    expect(payload.filename).toMatch(/\.zip$/)

    const { manifest, root } = await extractBundle(payload.data, join(dataDir, 'unpacked'))
    const paths = manifest.files.map((f) => f.path)

    expect(paths).toContain('challenge.yml')
    expect(paths).toContain('release_files/output.txt')
    expect(paths).toContain('writeup.md')
    expect(paths).toContain('solver/solve.py')
    expect(paths).toContain('LICENSE.txt')
    expect(paths).toContain('README.md')

    // An `event` licence does not include the generator: holding it would let
    // the buyer mint their own flags and defeat the per-order fingerprint.
    expect(paths.some((p) => p.startsWith('server_files/'))).toBe(false)

    const { readFile } = await import('node:fs/promises')
    const yaml = await readFile(join(root, 'challenge.yml'), 'utf8')
    const expectedFlag = deriveFlag({
      challengeVersionId: version.id,
      orderId: order.id,
      format: order.flagFormat,
    })
    expect(yaml).toContain(expectedFlag)
    expect(yaml).toContain('mode: static')

    const licence = await readFile(join(root, 'LICENSE.txt'), 'utf8')
    expect(licence).toContain('Buya')
    expect(licence).toContain(order.id)
  })

  it('gives two buyers different flags for the same challenge', async () => {
    const { seller, buyer } = await makeUsers()
    const second = await register({
      email: 'buyer2@aya.test',
      password: 'correct-horse-battery',
      name: 'Second',
    })
    const { listing } = await listedChallenge(seller)

    const orderA = await createOrder({ buyer, listing })
    const orderB = await createOrder({ buyer: second, listing })

    const flagA = deriveFlag({ challengeVersionId: listing.versionId, orderId: orderA.id })
    const flagB = deriveFlag({ challengeVersionId: listing.versionId, orderId: orderB.id })

    expect(flagA).not.toBe(flagB)
  })

  it('honours a buyer’s own flag format', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)

    const order = await createOrder({ buyer, listing, flagFormat: 'wonderctf{%s}' })
    await payFor(order)
    await queue.drain()

    const link = await issueDownloadLink(order.id, buyer)
    const payload = await redeemDownload(link.token, buyer)
    const { root } = await extractBundle(payload.data, join(dataDir, 'custom'))
    const { readFile } = await import('node:fs/promises')

    expect(await readFile(join(root, 'challenge.yml'), 'utf8')).toContain('wonderctf{')
  })

  it('ships the generator with an unlimited licence', async () => {
    const { seller, buyer } = await makeUsers()
    const { version } = await submitBundle({ seller, data: goodBundle() })
    await verifyVersion(version.id, seller.id)
    const draft = await createListing({
      seller,
      versionId: version.id,
      price: 500_000,
      licenseType: 'unlimited',
      summary: 'Reusable.',
    })
    const listing = await publishListing(draft.id, seller.id)

    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()

    const link = await issueDownloadLink(order.id, buyer)
    const payload = await redeemDownload(link.token, buyer)
    const { manifest } = await extractBundle(payload.data, join(dataDir, 'unlimited'))

    expect(manifest.files.map((f) => f.path)).toContain('server_files/generate.py')
  })
})

describe('the publish gate', () => {
  it('refuses to publish a version that was never verified', async () => {
    const { seller } = await makeUsers()
    const { version } = await submitBundle({ seller, data: goodBundle() })
    const listing = await createListing({
      seller,
      versionId: version.id,
      price: 100_000,
      licenseType: 'event',
      summary: 'Unverified.',
    })

    await expect(publishListing(listing.id, seller.id)).rejects.toThrow(/has not been verified/)
  })

  it('refuses to publish on a verdict the stub runner produced', async () => {
    // The badge would otherwise mean "nobody checked".
    setRunner(new StubRunner())
    const { seller } = await makeUsers()
    const { version } = await submitBundle({ seller, data: goodBundle() })

    const verification = await verifyVersion(version.id, seller.id)
    expect(verification.verdict).toBe('unverified')
    expect(verification.runnerKind).toBe('stub')

    const listing = await createListing({
      seller,
      versionId: version.id,
      price: 100_000,
      licenseType: 'event',
      summary: 'Stubbed.',
    })
    await expect(publishListing(listing.id, seller.id)).rejects.toThrow(/not passed verification/)
  })

  it('refuses to publish when the solver stops finding the flag', async () => {
    setRunner(realisticRunner({ solverStdout: () => 'no idea\n' }))
    const { seller } = await makeUsers()
    const { version } = await submitBundle({ seller, data: goodBundle() })
    await verifyVersion(version.id, seller.id)

    const listing = await createListing({
      seller,
      versionId: version.id,
      price: 100_000,
      licenseType: 'event',
      summary: 'Broken.',
    })
    await expect(publishListing(listing.id, seller.id)).rejects.toThrow(AppError)
  })

  it('takes a published listing down when re-verification fails', async () => {
    const { seller } = await makeUsers()
    const { listing, version } = await listedChallenge(seller)
    expect(listing.state).toBe('published')

    setRunner(realisticRunner({ solverResult: { status: 'failed', exitCode: 1 } }))
    await verifyVersion(version.id, seller.id)

    const after = await getStore().listings.get(listing.id)
    expect(after?.state).toBe('delisted')
    expect(await browse()).toHaveLength(0)
  })
})

describe('payment integrity', () => {
  it('refuses an unsigned notification', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })

    await expect(
      handleNotification({
        order_id: order.midtransOrderId,
        status_code: '200',
        gross_amount: notificationAmount(order.amount as never),
        transaction_status: 'settlement',
        signature_key: 'f'.repeat(128),
      }),
    ).rejects.toThrow(/signature is invalid/)

    expect((await getStore().orders.get(order.id))?.state).toBe('awaiting_payment')
  })

  it('is idempotent when the same notification arrives twice', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })

    const first = await payFor(order)
    const second = await payFor(order)

    expect(first.applied).toBe(true)
    expect(second.applied).toBe(false)

    await queue.drain()

    // One delivery, one accrual — not two.
    const deliveries = await getStore().deliveries.getByOrder(order.id)
    expect(deliveries).not.toBeNull()
    expect((await balanceFor(seller.id)).pending).toBe(135_000)
  })

  it('ignores a settlement that arrives after delivery', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })

    await payFor(order)
    await queue.drain()
    expect((await getStore().orders.get(order.id))?.state).toBe('delivered')

    const late = await payFor(order)
    expect(late.applied).toBe(false)
    expect((await getStore().orders.get(order.id))?.state).toBe('delivered')
  })

  it('does not deliver on a fraud-challenged capture', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })

    const outcome = await handleNotification(
      signNotification({
        order_id: order.midtransOrderId,
        status_code: '201',
        gross_amount: notificationAmount(order.amount as never),
        transaction_status: 'capture',
        fraud_status: 'challenge',
      }),
    )

    expect(outcome.applied).toBe(false)
    await queue.drain()
    expect((await getStore().orders.get(order.id))?.state).toBe('awaiting_payment')
  })

  it('acknowledges a notification for an order it does not know', async () => {
    await makeUsers()
    const outcome = await handleNotification(
      signNotification({
        order_id: 'AYA-does-not-exist',
        status_code: '200',
        gross_amount: '1000.00',
        transaction_status: 'settlement',
      }),
    )
    expect(outcome.applied).toBe(false)
    expect(outcome.note).toMatch(/Unknown order/)
  })

  it('marks an order failed on a denial, and never fulfils it', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })

    await payFor(order, 'deny')
    await queue.drain()

    expect((await getStore().orders.get(order.id))?.state).toBe('failed')
    expect(await getStore().deliveries.getByOrder(order.id)).toBeNull()
  })
})

describe('fulfilment failure after payment', () => {
  it('lands in fulfill_failed rather than stranding the order', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)

    // The build worked at verification time and breaks at fulfilment time.
    setRunner(realisticRunner({ generatorResult: { status: 'failed', exitCode: 1 } }))

    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()

    const failed = await getStore().orders.get(order.id)
    expect(failed?.state).toBe('fulfill_failed')
    expect(failed?.failureReason).toBeTruthy()
    // Money was taken but nothing was accrued to the seller.
    expect((await balanceFor(seller.id)).pending).toBe(0)
  })

  it('can be retried and then succeed', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)

    setRunner(realisticRunner({ generatorResult: { status: 'failed', exitCode: 1 } }))
    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()
    expect((await getStore().orders.get(order.id))?.state).toBe('fulfill_failed')

    setRunner(realisticRunner())
    const { runFulfillment } = await import('@/lib/commerce')
    const outcome = await runFulfillment(order.id)

    expect(outcome.state).toBe('delivered')
    expect((await balanceFor(seller.id)).pending).toBe(135_000)
  })

  it('can be refunded, reversing the seller accrual', async () => {
    const { admin, seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()

    expect((await balanceFor(seller.id)).pending).toBe(135_000)

    await refundOrder(order.id, admin.id, 'Buyer could not deploy it.')

    expect((await getStore().orders.get(order.id))?.state).toBe('refunded')
    expect((await balanceFor(seller.id)).pending).toBe(0)
  })
})

describe('access control', () => {
  it('stops a seller buying their own challenge', async () => {
    const { seller } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    await expect(createOrder({ buyer: seller, listing })).rejects.toThrow(/your own challenge/)
  })

  it('stops a stranger downloading somebody else’s purchase', async () => {
    const { seller, buyer } = await makeUsers()
    const stranger = await register({
      email: 'nosy@aya.test',
      password: 'correct-horse-battery',
      name: 'Nosy',
    })
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()

    const link = await issueDownloadLink(order.id, buyer)
    await expect(redeemDownload(link.token, stranger)).rejects.toThrow(/not yours/)
    await expect(issueDownloadLink(order.id, stranger)).rejects.toThrow(/not yours/)
  })

  it('enforces the download limit', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()

    for (let i = 0; i < 10; i++) {
      const link = await issueDownloadLink(order.id, buyer)
      await redeemDownload(link.token, buyer)
    }
    await expect(issueDownloadLink(order.id, buyer)).rejects.toThrow(/download limit/)
  })

  it('rejects a tampered download token', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()

    const link = await issueDownloadLink(order.id, buyer)
    const [id, expiry, signature] = link.token.split('.')
    const tampered = `${id}.${Number(expiry) + 86_400_000}.${signature}`

    await expect(redeemDownload(tampered, buyer)).rejects.toThrow(/Invalid download token/)
  })
})

describe('reviews and payouts', () => {
  it('accepts a review only from a delivered purchase', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })

    await expect(
      createReview({ reviewer: buyer, orderId: order.id, rating: 5, body: 'great' }),
    ).rejects.toThrow(/has been delivered/)

    await payFor(order)
    await queue.drain()

    const review = await createReview({
      reviewer: buyer,
      orderId: order.id,
      rating: 5,
      body: 'Clean idea, well written.',
    })
    expect(review.rating).toBe(5)

    await expect(
      createReview({ reviewer: buyer, orderId: order.id, rating: 1, body: 'again' }),
    ).rejects.toThrow(/already reviewed/)

    const [card] = await browse()
    expect(card?.rating).toEqual({ count: 1, average: 5 })
    expect(card?.soldCount).toBe(1)
  })

  it('matures the seller balance once the dispute window closes, then pays out', async () => {
    const { admin, seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()

    expect(await balanceFor(seller.id)).toMatchObject({ pending: 135_000, payable: 0 })

    // Still inside the window: nothing moves.
    expect(await maturePayouts(new Date())).toBe(0)

    const later = new Date(Date.now() + 73 * 3_600_000)
    expect(await maturePayouts(later)).toBe(1)
    expect(await balanceFor(seller.id)).toMatchObject({ pending: 0, payable: 135_000 })

    // Running it again must not credit twice.
    expect(await maturePayouts(later)).toBe(0)
    expect((await balanceFor(seller.id)).payable).toBe(135_000)

    await releasePayout({
      sellerId: seller.id,
      amount: 135_000,
      reference: 'BCA-2026-09-02-001',
      admin,
    })
    expect(await balanceFor(seller.id)).toMatchObject({ payable: 0, paid: 135_000 })
  })

  it('refuses a payout larger than the payable balance', async () => {
    const { admin, seller } = await makeUsers()
    await expect(
      releasePayout({ sellerId: seller.id, amount: 1_000, reference: 'nope', admin }),
    ).rejects.toThrow(/less than the requested amount/)
  })

  it('refuses a payout requested by a non-admin', async () => {
    const { seller, buyer } = await makeUsers()
    await expect(
      releasePayout({ sellerId: seller.id, amount: 1, reference: 'xxx', admin: buyer }),
    ).rejects.toThrow(/administrator/)
  })
})

describe('recovering a lost fulfilment', () => {
  it('requeues an order stranded in paid after a restart', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })

    // A queue with no handlers registered stands in for one lost to a restart:
    // the job is accepted, fails with "no handler", and is dropped.
    const lost = new InProcessQueue(2)
    setQueue(lost)
    await payFor(order)
    await lost.drain()

    expect((await getStore().orders.get(order.id))?.state).toBe('paid')
    expect(await getStore().deliveries.getByOrder(order.id)).toBeNull()

    // A fresh process comes up with a working queue.
    queue = new InProcessQueue(2)
    setQueue(queue)
    registerCommerceJobs()

    expect(await recoverStalledFulfilments(0)).toBe(1)
    await queue.drain()

    expect((await getStore().orders.get(order.id))?.state).toBe('delivered')
  })

  it('leaves a fresh order alone', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()

    // Delivered orders are not stalled fulfilments.
    expect(await recoverStalledFulfilments(0)).toBe(0)
  })
})

describe('a static bundle', () => {
  it('verifies against its literal flag and delivers that flag to every buyer', async () => {
    const { seller, buyer } = await makeUsers()

    // Its solver prints the baked-in flag, because there is nothing to generate.
    setRunner(new FakeRunner(async () => runResult({ stdout: `${STATIC_FLAG}\n` })))

    const { version } = await submitBundle({
      seller,
      data: goodBundle({ flagMode: 'static', includeGenerator: false }),
    })
    const verification = await verifyVersion(version.id, seller.id)
    expect(verification.verdict).toBe('passed')

    const draft = await createListing({
      seller,
      versionId: version.id,
      price: 50_000,
      licenseType: 'event',
      summary: 'A legacy import with a fixed flag.',
    })
    const listing = await publishListing(draft.id, seller.id)

    const [card] = await browse()
    expect(card?.reflaggable).toBe(false)

    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()

    const link = await issueDownloadLink(order.id, buyer)
    const payload = await redeemDownload(link.token, buyer)
    const { root } = await extractBundle(payload.data, join(dataDir, 'static'))
    const { readFile } = await import('node:fs/promises')
    const yaml = await readFile(join(root, 'challenge.yml'), 'utf8')

    // The buyer's derived flag must NOT appear: the handout encodes the
    // author's literal flag, and stating anything else ships an unsolvable
    // challenge.
    expect(yaml).toContain(STATIC_FLAG)
    expect(yaml).not.toContain(
      deriveFlag({ challengeVersionId: version.id, orderId: order.id }),
    )

    const readme = await readFile(join(root, 'README.md'), 'utf8')
    expect(readme).toMatch(/fixed flag/i)
  })
})

describe('the audit trail', () => {
  it('records every step, and never contains a flag', async () => {
    const { seller, buyer } = await makeUsers()
    const { listing } = await listedChallenge(seller)
    const order = await createOrder({ buyer, listing })
    await payFor(order)
    await queue.drain()

    const entries = await getStore().audit.list({ limit: 200 })
    const actions = entries.map((e) => e.action)

    expect(actions).toContain('challenge.version.submitted')
    expect(actions).toContain('challenge.verification.passed')
    expect(actions).toContain('listing.published')
    expect(actions).toContain('order.created')
    expect(actions).toContain('order.paid')
    expect(actions).toContain('order.delivered')

    const serialized = JSON.stringify(entries)
    expect(serialized).not.toMatch(/ayactf\{[a-z2-7]{20}\}/)

    for (const entry of entries) {
      expect(entry.actor).toBeTruthy()
    }
  })
})
