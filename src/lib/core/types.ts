import type { ChallengeSpec, Difficulty, SandboxProfile } from './bundle'
import type { LicenseTerms, LicenseType } from './license'
import type { BundleManifest } from './manifest'
import type { Rupiah } from './money'

/**
 * The entities. See .wondev/memory/domain-model.md for the relationships and
 * the rules that are enforced in code rather than by types.
 */

// --- Users ------------------------------------------------------------------

export const ROLES = ['buyer', 'seller', 'admin'] as const
export type Role = (typeof ROLES)[number]

export interface User {
  id: string
  email: string
  /** Public display name — appears on listings and in delivered LICENSE.txt. */
  name: string
  passwordHash: string
  roles: Role[]
  createdAt: Date
}

// --- Challenges -------------------------------------------------------------

export interface Challenge {
  id: string
  sellerId: string
  title: string
  slug: string
  category: string
  currentVersionId: string | null
  createdAt: Date
  updatedAt: Date
}

/** Immutable. A new upload is a new version, never an edit. */
export interface ChallengeVersion {
  id: string
  challengeId: string
  /** Monotonic per challenge, starting at 1. */
  ordinal: number
  bundleHash: string
  manifest: BundleManifest
  spec: ChallengeSpec
  /** Where the uploaded bundle lives, relative to the data dir. */
  storageKey: string
  createdAt: Date
}

// --- Verification -----------------------------------------------------------

export const VERDICTS = ['passed', 'failed', 'unverified', 'error'] as const
export type Verdict = (typeof VERDICTS)[number]

export interface Verification {
  id: string
  versionId: string
  /** The hash this verdict is about. A mismatch invalidates the verdict. */
  bundleHash: string
  verdict: Verdict
  runnerKind: 'docker' | 'stub'
  profile: SandboxProfile
  /** Wall-clock of the solver run. Operational, NOT a difficulty signal. */
  durationMs: number
  /** Flag-scrubbed, byte-capped. Shown to the seller, never to a buyer. */
  log: string
  message: string
  createdAt: Date
}

// --- Listings ---------------------------------------------------------------

export const LISTING_STATES = ['draft', 'pending', 'published', 'rejected', 'delisted'] as const
export type ListingState = (typeof LISTING_STATES)[number]

export interface Listing {
  id: string
  challengeId: string
  versionId: string
  sellerId: string
  title: string
  slug: string
  /** Public teaser. Never the handout, never the writeup. */
  summary: string
  schemes: string[]
  difficulty: Difficulty
  price: Rupiah
  licenseType: LicenseType
  state: ListingState
  /** Set when an admin rejects; shown to the seller. */
  rejectionReason: string | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// --- Orders -----------------------------------------------------------------

export const ORDER_STATES = [
  'created',
  'awaiting_payment',
  'paid',
  'fulfilling',
  'delivered',
  'fulfill_failed',
  'expired',
  'failed',
  'cancelled',
  'refunded',
] as const
export type OrderState = (typeof ORDER_STATES)[number]

export interface Order {
  id: string
  /** The id given to Midtrans. Distinct from `id` so it can be reissued. */
  midtransOrderId: string
  buyerId: string
  sellerId: string
  listingId: string
  versionId: string
  /** Frozen at creation. Never re-read from a webhook body. */
  amount: Rupiah
  commission: Rupiah
  sellerNet: Rupiah
  /** Snapshotted at purchase — a later listing edit must not change it. */
  licenseTerms: LicenseTerms
  /** Buyer's chosen flag format for their event. */
  flagFormat: string
  state: OrderState
  snapToken: string | null
  snapRedirectUrl: string | null
  paymentType: string | null
  failureReason: string | null
  fulfillAttempts: number
  expiresAt: Date
  paidAt: Date | null
  deliveredAt: Date | null
  /** After this, funds become payable and refunds close. */
  disputeUntil: Date | null
  /** Set once the seller's share has moved from pending to payable. */
  payoutMaturedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// --- Delivery ---------------------------------------------------------------

export interface Delivery {
  id: string
  orderId: string
  /** Where the built artifact lives, relative to the data dir. */
  storageKey: string
  sizeBytes: number
  sha256: string
  downloadCount: number
  maxDownloads: number
  expiresAt: Date
  createdAt: Date
}

// --- Reviews ----------------------------------------------------------------

export interface Review {
  id: string
  orderId: string
  listingId: string
  challengeId: string
  reviewerId: string
  reviewerName: string
  /** 1–5. */
  rating: number
  body: string
  createdAt: Date
}

// --- Payouts ----------------------------------------------------------------

export interface PayoutBalance {
  sellerId: string
  /** Delivered, inside the dispute window. */
  pending: Rupiah
  /** Dispute window closed; an admin may release it. */
  payable: Rupiah
  /** Released. */
  paid: Rupiah
  updatedAt: Date
}

export interface PayoutRelease {
  id: string
  sellerId: string
  amount: Rupiah
  reference: string
  releasedBy: string
  createdAt: Date
}

// --- Audit ------------------------------------------------------------------

export interface AuditEntry {
  id: string
  /** User id, or `system` for scheduled work. Never null. */
  actor: string
  action: string
  subjectType: string
  subjectId: string
  /** Never contains a flag, a solver body, or a secret. */
  detail: Record<string, unknown>
  createdAt: Date
}
