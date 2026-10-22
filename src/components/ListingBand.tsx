import Link from 'next/link'
import { CipherPlate } from '@/components/CipherPlate'
import { VerificationReceipt } from '@/components/VerificationReceipt'
import type { PublicListing } from '@/lib/catalog'
import { formatIdr } from '@/lib/ui/cn'

/**
 * One entry in the catalogue.
 *
 * A ruled band rather than a card: this reads as an instrument catalogue, and
 * the sealed plate is the anchor because it is the only honest picture of the
 * goods we can show.
 */
export function ListingBand({ listing }: { listing: PublicListing }) {
  return (
    <article className="band">
      <Link
        href={`/c/${listing.slug}`}
        className="grid grid-cols-1 gap-5 px-5 py-6 sm:grid-cols-[13rem_1fr] sm:items-start"
      >
        <CipherPlate seed={listing.id} scheme={listing.schemes[0]?.id ?? 'hash'} rows={5} width={26} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-sans text-xl font-semibold tracking-tight">{listing.title}</h2>
            <VerificationReceipt verified={listing.verified} variant="inline" />
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-eyebrow uppercase text-muted">
            {listing.schemes.map((scheme) => (
              <span key={scheme.id}>{scheme.name}</span>
            ))}
            <span aria-hidden="true">·</span>
            <span>{listing.difficulty}</span>
          </p>

          <p className="mt-3 max-w-prose font-serif text-[0.9375rem] leading-relaxed text-muted">
            {listing.summary}
          </p>

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 border-t border-rule pt-3">
            <p className="font-mono text-xs text-muted">
              <span className="tnum">{listing.files.length}</span> file
              {listing.files.length === 1 ? '' : 's'}
              {listing.hintCount > 0 && (
                <>
                  {' · '}
                  <span className="tnum">{listing.hintCount}</span> hint
                  {listing.hintCount === 1 ? '' : 's'}
                </>
              )}
              {' · '}
              {listing.licenseName.toLowerCase()}
              {' · by '}
              <span className="text-ink">{listing.seller.name}</span>
              {listing.rating.count > 0 && (
                <>
                  {' · '}
                  <span className="tnum text-ink">{listing.rating.average.toFixed(1)}</span>/5 from{' '}
                  <span className="tnum">{listing.rating.count}</span>
                </>
              )}
            </p>
            <p className="font-mono text-lg font-medium tabular-nums text-seal">
              {formatIdr(listing.price)}
            </p>
          </div>
        </div>
      </Link>
    </article>
  )
}
