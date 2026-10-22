import { isReflaggable } from '@/lib/core/bundle'
import { publicFileManifest } from '@/lib/core/manifest'
import { AppError, err } from '@/lib/core/errors'
import { newId } from '@/lib/core/ids'
import { LICENSES, type LicenseType } from '@/lib/core/license'
import { rupiah, type Rupiah } from '@/lib/core/money'
import { uniqueSlug } from '@/lib/core/slug'
import type { Listing, User, Verification } from '@/lib/core/types'
import { auditEntry, getStore } from '@/lib/store'
import type { ListingQuery } from '@/lib/store/types'
import { getScheme } from './taxonomy'

/**
 * Listings — the commercial wrapper around an immutable challenge version.
 *
 * The publish gate is the load-bearing rule of the whole marketplace, and it is
 * implemented in exactly one place: `publishListing`.
 */

const MIN_PRICE = 0
const MAX_PRICE = 50_000_000 // Rp 50 juta — a sanity bound, not a business rule.
const MAX_SUMMARY = 400

export interface CreateListingInput {
  seller: User
  versionId: string
  price: number
  licenseType: LicenseType
  summary: string
}

export async function createListing(input: CreateListingInput): Promise<Listing> {
  const store = getStore()

  const version = await store.versions.get(input.versionId)
  if (!version) throw err.notFound('Version')

  const challenge = await store.challenges.get(version.challengeId)
  if (!challenge) throw err.notFound('Challenge')
  if (challenge.sellerId !== input.seller.id) {
    throw err.forbidden('That challenge belongs to somebody else.')
  }

  if (!Number.isInteger(input.price) || input.price < MIN_PRICE || input.price > MAX_PRICE) {
    throw err.validation(`Price must be a whole number of rupiah between 0 and ${MAX_PRICE}.`)
  }
  const summary = input.summary.trim()
  if (summary.length === 0 || summary.length > MAX_SUMMARY) {
    throw err.validation(`The summary must be between 1 and ${MAX_SUMMARY} characters.`)
  }

  const slug = await uniqueSlug(
    challenge.title,
    async (candidate) => (await store.listings.getBySlug(candidate)) !== null,
  )

  const now = new Date()
  const listing = await store.listings.create({
    id: newId('listing'),
    challengeId: challenge.id,
    versionId: version.id,
    sellerId: input.seller.id,
    title: challenge.title,
    slug,
    summary,
    schemes: [...version.spec.aya.scheme],
    difficulty: version.spec.aya.difficulty,
    price: rupiah(input.price) as Rupiah,
    licenseType: input.licenseType,
    state: 'draft',
    rejectionReason: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  await store.audit.append(
    auditEntry(input.seller.id, 'listing.created', 'listing', listing.id, {
      versionId: version.id,
      price: listing.price,
    }),
  )

  return listing
}

/**
 * The one gate.
 *
 * A listing goes live only against a `passed` verification whose recorded
 * bundle hash still equals the version's. Everything else about the "Verified
 * solvable" badge follows from this being the only path to `published`.
 */
export async function publishListing(listingId: string, actor: string): Promise<Listing> {
  const store = getStore()

  const listing = await store.listings.get(listingId)
  if (!listing) throw err.notFound('Listing')
  if (listing.state === 'published') return listing

  const version = await store.versions.get(listing.versionId)
  if (!version) throw err.notFound('Version')

  const passing = await store.verifications.passingForHash(version.id, version.bundleHash)
  if (!passing) {
    const latest = await store.verifications.latestForVersion(version.id)
    throw new AppError(
      'verification_required',
      latest
        ? `This version has not passed verification (last result: ${latest.verdict}). ${latest.message}`
        : 'This version has not been verified yet. Run verification before publishing.',
      { details: { versionId: version.id, lastVerdict: latest?.verdict ?? null } },
    )
  }

  const published = await store.listings.update(listing.id, {
    state: 'published',
    publishedAt: listing.publishedAt ?? new Date(),
    rejectionReason: null,
  })

  await store.audit.append(
    auditEntry(actor, 'listing.published', 'listing', listing.id, {
      versionId: version.id,
      verificationId: passing.id,
    }),
  )

  return published
}

export async function delistListing(
  listingId: string,
  actor: string,
  reason: string,
): Promise<Listing> {
  const store = getStore()
  const listing = await store.listings.get(listingId)
  if (!listing) throw err.notFound('Listing')

  const updated = await store.listings.update(listing.id, {
    state: 'delisted',
    rejectionReason: reason.slice(0, 500),
  })

  await store.audit.append(
    auditEntry(actor, 'listing.delisted', 'listing', listing.id, {
      reason: reason.slice(0, 300),
    }),
  )
  return updated
}

/**
 * Point a listing at a newer version.
 *
 * Always drops it out of `published`: the new version carries a different
 * bundle hash, so whatever verification justified the badge no longer describes
 * what would be sold.
 */
export async function pointListingAtVersion(
  listingId: string,
  versionId: string,
  actor: string,
): Promise<Listing> {
  const store = getStore()
  const listing = await store.listings.get(listingId)
  if (!listing) throw err.notFound('Listing')

  const version = await store.versions.get(versionId)
  if (!version) throw err.notFound('Version')
  if (version.challengeId !== listing.challengeId) {
    throw err.validation('That version belongs to a different challenge.')
  }

  const updated = await store.listings.update(listing.id, {
    versionId: version.id,
    schemes: [...version.spec.aya.scheme],
    difficulty: version.spec.aya.difficulty,
    state: 'draft',
    publishedAt: null,
    rejectionReason: null,
  })

  await store.audit.append(
    auditEntry(actor, 'listing.repointed', 'listing', listing.id, {
      versionId: version.id,
      previousVersionId: listing.versionId,
    }),
  )

  return updated
}

// --- Public views -----------------------------------------------------------

export interface PublicListing {
  id: string
  slug: string
  title: string
  summary: string
  price: number
  priceLabel: string
  licenseType: LicenseType
  licenseName: string
  difficulty: Listing['difficulty']
  schemes: Array<{ id: string; name: string; tell: string }>
  seller: { id: string; name: string }
  verified: { at: string; durationMs: number } | null
  /**
   * Whether each buyer gets their own flag. False for `static` bundles, which
   * ship a fixed flag to everybody — a real buying consideration, so it is
   * stated rather than left to be discovered after payment.
   */
  reflaggable: boolean
  /** Names and sizes only. Never contents. */
  files: Array<{ path: string; size: number }>
  hintCount: number
  writeupBytes: number
  rating: { count: number; average: number }
  soldCount: number
  publishedAt: string | null
}

/**
 * Everything a buyer may see before paying.
 *
 * The omissions are the point: no handout contents, no writeup body, no solver,
 * and no server-file names — a filename like
 * `generate_rsa_with_shared_prime.py` gives the challenge away as surely as the
 * file itself would.
 */
export async function toPublicListing(listing: Listing): Promise<PublicListing> {
  const store = getStore()
  const version = await store.versions.get(listing.versionId)
  const seller = await store.users.get(listing.sellerId)
  const rating = await store.reviews.summary(listing.challengeId)
  const soldCount = await store.orders.countForListing(listing.id)

  const passing = version
    ? await store.verifications.passingForHash(version.id, version.bundleHash)
    : null

  const writeup = version?.manifest.files.find((f) => f.path === 'writeup.md')

  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    summary: listing.summary,
    price: listing.price,
    priceLabel: `Rp ${listing.price.toLocaleString('id-ID')}`,
    licenseType: listing.licenseType,
    licenseName: LICENSES[listing.licenseType].name,
    difficulty: listing.difficulty,
    schemes: listing.schemes.map((id) => {
      const scheme = getScheme(id)
      return { id, name: scheme?.name ?? id, tell: scheme?.tell ?? '' }
    }),
    seller: { id: listing.sellerId, name: seller?.name ?? 'Unknown' },
    verified: passing
      ? { at: passing.createdAt.toISOString(), durationMs: passing.durationMs }
      : null,
    reflaggable: version ? isReflaggable(version.spec) : true,
    files: version ? publicFileManifest(version.manifest) : [],
    hintCount: version?.spec.hints?.length ?? 0,
    writeupBytes: writeup?.size ?? 0,
    rating,
    soldCount,
    publishedAt: listing.publishedAt?.toISOString() ?? null,
  }
}

export async function browse(query: ListingQuery = {}): Promise<PublicListing[]> {
  const store = getStore()
  const listings = await store.listings.query({ ...query, state: 'published' })
  return Promise.all(listings.map(toPublicListing))
}

export async function findPublicListing(slug: string): Promise<PublicListing | null> {
  const store = getStore()
  const listing = await store.listings.getBySlug(slug)
  if (!listing || listing.state !== 'published') return null
  return toPublicListing(listing)
}

/** Verification history for a seller's own version. */
export async function verificationsFor(versionId: string): Promise<Verification[]> {
  return getStore().verifications.listForVersion(versionId)
}
