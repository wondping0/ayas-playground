import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CHALLENGE_YAML,
  parseChallengeYaml,
  validateBundleStructure,
  type ChallengeSpec,
} from '@/lib/core/bundle'
import { AppError, err } from '@/lib/core/errors'
import { newId } from '@/lib/core/ids'
import { runsRoot } from '@/lib/core/paths'
import { slugify, uniqueSlug } from '@/lib/core/slug'
import type { Challenge, ChallengeVersion, User, Verification } from '@/lib/core/types'
import { extractBundle, getRunner, verifyBundle } from '@/lib/forge'
import { auditEntry, getStore } from '@/lib/store'
import { bundleKey, bundles } from '@/lib/store/blobs'
import { unknownSchemes } from './taxonomy'

/**
 * Submitting and verifying challenges.
 *
 * A submission is inspected, stored as an immutable version, and then verified.
 * Nothing here publishes anything — that gate lives in listings.ts, and it
 * reads the verification rather than trusting this module.
 */

export interface SubmitResult {
  challenge: Challenge
  version: ChallengeVersion
  spec: ChallengeSpec
}

/**
 * Read and validate an uploaded bundle without keeping it.
 *
 * Extraction happens into a throwaway directory purely to read `challenge.yml`
 * and hash the contents; the bundle itself is stored as the original zip, so
 * what is verified later is byte-identical to what was uploaded.
 */
async function inspect(data: Buffer): Promise<{ spec: ChallengeSpec; manifest: Awaited<ReturnType<typeof extractBundle>>['manifest'] }> {
  const scratch = join(runsRoot(), `inspect-${newId('run')}`)
  try {
    const { manifest, root } = await extractBundle(data, scratch)

    const yamlPath = join(root, CHALLENGE_YAML)
    const text = await readFile(yamlPath, 'utf8').catch(() => {
      throw new AppError('bundle_invalid', 'The bundle has no challenge.yml at its root.')
    })

    const spec = parseChallengeYaml(text)

    const issues = validateBundleStructure(spec, manifest)
    if (issues.length > 0) {
      throw new AppError('bundle_invalid', 'The bundle is incomplete.', {
        details: { issues },
      })
    }

    const unknown = unknownSchemes(spec.aya.scheme)
    if (unknown.length > 0) {
      throw new AppError(
        'bundle_invalid',
        `Unknown scheme(s): ${unknown.join(', ')}. Pick one from the taxonomy.`,
        { details: { unknown } },
      )
    }

    return { spec, manifest }
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
  }
}

export interface SubmitInput {
  seller: User
  data: Buffer
  /** Add a version to an existing challenge instead of creating a new one. */
  challengeId?: string
}

export async function submitBundle(input: SubmitInput): Promise<SubmitResult> {
  const store = getStore()
  const { spec, manifest } = await inspect(input.data)

  let challenge: Challenge
  if (input.challengeId) {
    const existing = await store.challenges.get(input.challengeId)
    if (!existing) throw err.notFound('Challenge')
    if (existing.sellerId !== input.seller.id) {
      throw err.forbidden('That challenge belongs to somebody else.')
    }
    challenge = existing
  } else {
    const slug = await uniqueSlug(
      spec.name,
      async (candidate) => (await store.challenges.getBySlug(candidate)) !== null,
    )
    const now = new Date()
    challenge = await store.challenges.create({
      id: newId('challenge'),
      sellerId: input.seller.id,
      title: spec.name,
      slug,
      category: spec.category,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  const versionId = newId('version')
  const key = bundleKey(versionId)
  await bundles.put(key, input.data)

  const version = await store.versions.create({
    id: versionId,
    challengeId: challenge.id,
    ordinal: await store.versions.nextOrdinal(challenge.id),
    bundleHash: manifest.bundleHash,
    manifest,
    spec,
    storageKey: key,
    createdAt: new Date(),
  })

  challenge = await store.challenges.update(challenge.id, {
    currentVersionId: version.id,
    title: spec.name,
  })

  await store.audit.append(
    auditEntry(input.seller.id, 'challenge.version.submitted', 'version', version.id, {
      challengeId: challenge.id,
      ordinal: version.ordinal,
      bundleHash: version.bundleHash,
    }),
  )

  return { challenge, version, spec }
}

/**
 * Run the solver against a freshly built copy and record the verdict.
 *
 * Idempotent in the sense that it can be re-run; each run appends a new
 * verification rather than overwriting, so a seller can see that their third
 * attempt is the one that passed.
 */
export async function verifyVersion(versionId: string, actor: string): Promise<Verification> {
  const store = getStore()
  const version = await store.versions.get(versionId)
  if (!version) throw err.notFound('Version')

  const data = await bundles.get(version.storageKey)
  const outcome = await verifyBundle({
    bundleData: data,
    spec: version.spec,
    runner: getRunner(),
  })

  const verification = await store.verifications.create({
    id: newId('verification'),
    versionId: version.id,
    // Binding the verdict to the hash is what stops a badge outliving what it
    // verified.
    bundleHash: version.bundleHash,
    verdict: outcome.verdict,
    runnerKind: getRunner().kind,
    profile: version.spec.aya.solver.profile,
    durationMs: outcome.durationMs,
    log: outcome.log.slice(0, 64_000),
    message: outcome.message,
    createdAt: new Date(),
  })

  await store.audit.append(
    auditEntry(actor, `challenge.verification.${outcome.verdict}`, 'version', version.id, {
      durationMs: outcome.durationMs,
      runner: verification.runnerKind,
    }),
  )

  // A version that stops verifying takes its listings down with it.
  if (outcome.verdict !== 'passed') {
    const listings = await store.listings.listForVersion(version.id)
    for (const listing of listings) {
      if (listing.state === 'published') {
        await store.listings.update(listing.id, {
          state: 'delisted',
          rejectionReason: `Verification no longer passes: ${outcome.message}`,
        })
        await store.audit.append(
          auditEntry('system', 'listing.auto_delisted', 'listing', listing.id, {
            versionId: version.id,
            verdict: outcome.verdict,
          }),
        )
      }
    }
  }

  return verification
}

export async function challengeSummary(challengeId: string) {
  const store = getStore()
  const challenge = await store.challenges.get(challengeId)
  if (!challenge) throw err.notFound('Challenge')

  const versions = await store.versions.listForChallenge(challengeId)
  const reviews = await store.reviews.summary(challengeId)

  return { challenge, versions, reviews }
}

export { slugify }
