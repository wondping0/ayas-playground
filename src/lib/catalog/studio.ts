import { err } from '@/lib/core/errors'
import type { Difficulty } from '@/lib/core/bundle'
import type { LicenseType } from '@/lib/core/license'
import type { ListingState, User, Verdict } from '@/lib/core/types'
import { getStore } from '@/lib/store'

/**
 * Read models for the seller studio.
 *
 * A seller sees their own verification logs — including failures — because
 * that is how they fix a broken bundle. A buyer never sees any of this.
 */

export interface StudioVersion {
  id: string
  ordinal: number
  bundleHash: string
  createdAt: string
  fileCount: number
  scheme: string[]
  difficulty: Difficulty
  flagMode: string
  profile: string
  latest: {
    verdict: Verdict
    message: string
    durationMs: number
    runner: 'docker' | 'stub'
    log: string
    createdAt: string
  } | null
  /** True when a passing verdict still matches this version's hash. */
  publishable: boolean
}

export interface StudioListing {
  id: string
  slug: string
  state: ListingState
  price: number
  priceLabel: string
  licenseType: LicenseType
  summary: string
  versionId: string
  rejectionReason: string | null
  soldCount: number
}

export interface StudioChallenge {
  id: string
  title: string
  slug: string
  createdAt: string
  versions: StudioVersion[]
  listings: StudioListing[]
}

export async function studioChallenge(
  challengeId: string,
  user: User,
): Promise<StudioChallenge> {
  const store = getStore()

  const challenge = await store.challenges.get(challengeId)
  if (!challenge) throw err.notFound('Challenge')
  if (challenge.sellerId !== user.id && !user.roles.includes('admin')) {
    throw err.forbidden('That challenge belongs to somebody else.')
  }

  const versions = await store.versions.listForChallenge(challenge.id)

  const studioVersions = await Promise.all(
    versions.map(async (version): Promise<StudioVersion> => {
      const [latest, passing] = await Promise.all([
        store.verifications.latestForVersion(version.id),
        store.verifications.passingForHash(version.id, version.bundleHash),
      ])
      return {
        id: version.id,
        ordinal: version.ordinal,
        bundleHash: version.bundleHash,
        createdAt: version.createdAt.toISOString(),
        fileCount: version.manifest.files.length,
        scheme: [...version.spec.aya.scheme],
        difficulty: version.spec.aya.difficulty,
        flagMode: version.spec.aya.flag.mode,
        profile: version.spec.aya.solver.profile,
        latest: latest
          ? {
              verdict: latest.verdict,
              message: latest.message,
              durationMs: latest.durationMs,
              runner: latest.runnerKind,
              log: latest.log,
              createdAt: latest.createdAt.toISOString(),
            }
          : null,
        publishable: passing !== null,
      }
    }),
  )

  const listings = await Promise.all(
    versions.map((version) => store.listings.listForVersion(version.id)),
  )

  const studioListings = await Promise.all(
    listings.flat().map(async (listing): Promise<StudioListing> => ({
      id: listing.id,
      slug: listing.slug,
      state: listing.state,
      price: listing.price,
      priceLabel: `Rp ${listing.price.toLocaleString('id-ID')}`,
      licenseType: listing.licenseType,
      summary: listing.summary,
      versionId: listing.versionId,
      rejectionReason: listing.rejectionReason,
      soldCount: await store.orders.countForListing(listing.id),
    })),
  )

  return {
    id: challenge.id,
    title: challenge.title,
    slug: challenge.slug,
    createdAt: challenge.createdAt.toISOString(),
    versions: studioVersions,
    listings: studioListings,
  }
}

export async function studioChallenges(user: User): Promise<StudioChallenge[]> {
  const challenges = await getStore().challenges.listForSeller(user.id, { limit: 100 })
  return Promise.all(challenges.map((challenge) => studioChallenge(challenge.id, user)))
}
