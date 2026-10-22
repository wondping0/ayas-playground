import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BuyPanel } from '@/components/BuyPanel'
import { CipherPlate } from '@/components/CipherPlate'
import { VerificationReceipt } from '@/components/VerificationReceipt'
import { findPublicListing, reviewsForListing } from '@/lib/catalog'
import { currentUser } from '@/lib/auth'
import { LICENSES } from '@/lib/core/license'
import { formatDate } from '@/lib/ui/cn'

export const dynamic = 'force-dynamic'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default async function ListingPage({ params }: { params: { slug: string } }) {
  const listing = await findPublicListing(params.slug)
  if (!listing) notFound()

  const [reviews, user] = await Promise.all([reviewsForListing(listing.id), currentUser().catch(() => null)])
  const licence = LICENSES[listing.licenseType]
  const ownListing = user?.id === listing.seller.id

  return (
    <div className="mx-auto max-w-shelf px-5 py-10">
      <Link href="/" className="eyebrow transition-colors hover:text-ink">
        ← Back to the catalogue
      </Link>

      <div className="mt-8 grid gap-10 lg:grid-cols-[22rem_1fr] lg:gap-14">
        {/* The sealed goods, and the most a buyer is allowed to know about them. */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <CipherPlate
            seed={listing.id}
            scheme={listing.schemes[0]?.id ?? 'hash'}
            rows={9}
            width={34}
            size="lg"
          />

          <section className="mt-6">
            <h2 className="eyebrow">What you receive</h2>
            <ul className="mt-2 divide-y divide-rule border-y border-rule font-mono text-xs">
              {listing.files.map((file) => (
                <li key={file.path} className="flex items-baseline justify-between gap-4 py-1.5">
                  <span className="truncate">{file.path}</span>
                  <span className="tnum shrink-0 text-muted">{formatBytes(file.size)}</span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-4 py-1.5">
                <span className="truncate">writeup.md</span>
                <span className="tnum shrink-0 text-muted">
                  {formatBytes(listing.writeupBytes)}
                </span>
              </li>
              <li className="flex items-baseline justify-between gap-4 py-1.5">
                <span className="truncate">solver/</span>
                <span className="shrink-0 text-muted">included</span>
              </li>
            </ul>
            <p className="mt-3 font-serif text-xs leading-relaxed text-muted">
              File names and sizes only. The contents stay sealed — a filename can give away the
              solve as surely as the file.
            </p>
          </section>
        </div>

        <div className="min-w-0">
          <p className="eyebrow">
            {listing.difficulty} · {listing.licenseName}
          </p>
          <h1 className="mt-3 font-sans text-4xl font-semibold leading-tight tracking-tight">
            {listing.title}
          </h1>
          <p className="mt-2 font-mono text-xs text-muted">
            by <span className="text-ink">{listing.seller.name}</span>
            {listing.publishedAt && <> · listed {formatDate(listing.publishedAt)}</>}
            {listing.soldCount > 0 && (
              <>
                {' · '}
                <span className="tnum text-ink">{listing.soldCount}</span> sold
              </>
            )}
          </p>

          <p className="mt-6 max-w-prose font-serif text-lg leading-relaxed">{listing.summary}</p>

          {/* The scheme's tell is the whole point: it says what kind of puzzle
              this is without saying what the puzzle is. */}
          <section className="mt-8">
            <h2 className="eyebrow">What kind of challenge this is</h2>
            <dl className="mt-3 divide-y divide-rule border-y border-rule">
              {listing.schemes.map((scheme) => (
                <div key={scheme.id} className="py-3">
                  <dt className="font-sans text-sm font-semibold">{scheme.name}</dt>
                  <dd className="mt-1 font-serif text-sm leading-relaxed text-muted">
                    Players recognise it by: {scheme.tell}.
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <VerificationReceipt verified={listing.verified} />

            <section className="border border-rule px-4 py-3">
              <h2 className="eyebrow">{licence.name}</h2>
              <p className="mt-2 font-serif text-sm leading-relaxed">{licence.summary}</p>
              <ul className="mt-3 space-y-1 font-mono text-xs text-muted">
                {licence.grants.map((grant) => (
                  <li key={grant} className="flex gap-2">
                    <span className="text-verify" aria-hidden="true">
                      +
                    </span>
                    <span>{grant}</span>
                  </li>
                ))}
                {licence.restrictions.map((restriction) => (
                  <li key={restriction} className="flex gap-2">
                    <span className="text-danger" aria-hidden="true">
                      −
                    </span>
                    <span>{restriction}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <BuyPanel
            listingId={listing.id}
            priceLabel={listing.priceLabel}
            signedIn={Boolean(user)}
            ownListing={ownListing}
            reflaggable={listing.reflaggable}
          />

          <section className="mt-12">
            <h2 className="eyebrow">
              Reviews{' '}
              {listing.rating.count > 0 && (
                <span className="text-ink">
                  · <span className="tnum">{listing.rating.average.toFixed(1)}</span>/5 from{' '}
                  <span className="tnum">{listing.rating.count}</span>
                </span>
              )}
            </h2>

            {reviews.length === 0 ? (
              <p className="mt-3 font-serif text-sm leading-relaxed text-muted">
                No reviews yet. Only people who bought this challenge can leave one.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-rule border-y border-rule">
                {reviews.map((review) => (
                  <li key={review.id} className="py-4">
                    <p className="flex items-baseline gap-3">
                      <span className="font-mono text-sm tabular-nums text-seal">
                        {'★'.repeat(review.rating)}
                        <span className="text-rule">{'★'.repeat(5 - review.rating)}</span>
                      </span>
                      <span className="font-sans text-sm font-medium">{review.reviewerName}</span>
                      <span className="font-mono text-eyebrow uppercase text-muted">
                        {formatDate(review.createdAt)}
                      </span>
                    </p>
                    {review.body && (
                      <p className="mt-2 max-w-prose font-serif text-sm leading-relaxed text-muted">
                        {review.body}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
