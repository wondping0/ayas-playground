'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { StudioListing } from '@/lib/catalog'
import { LICENSE_TYPES, LICENSES, type LicenseType } from '@/lib/core/license'

/**
 * Pricing and publishing, per version.
 *
 * The publish button is disabled until a passing verification matches this
 * exact bundle — the gate lives on the server, but the reason is stated here
 * so a seller is not left guessing.
 */
export function ListingControls({
  versionId,
  publishable,
  listings,
}: {
  versionId: string
  publishable: boolean
  listings: StudioListing[]
}) {
  const router = useRouter()
  const [price, setPrice] = useState('150000')
  const [licenseType, setLicenseType] = useState<LicenseType>('event')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(url: string, body: unknown) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok) {
        setError(payload?.error?.message ?? 'That did not work.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-t border-rule pt-4">
      {error && (
        <p role="alert" className="mb-3 font-mono text-xs text-danger">
          {error}
        </p>
      )}

      {listings.length > 0 && (
        <ul className="mb-4 space-y-2">
          {listings.map((listing) => (
            <li
              key={listing.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-rule px-3 py-2"
            >
              <span className="font-mono text-sm tabular-nums text-seal">
                {listing.priceLabel}
              </span>
              <span className="font-mono text-eyebrow uppercase text-muted">
                {LICENSES[listing.licenseType].name}
              </span>
              <span
                className={`font-mono text-eyebrow uppercase ${
                  listing.state === 'published' ? 'text-verify' : 'text-muted'
                }`}
              >
                {listing.state}
              </span>
              {listing.soldCount > 0 && (
                <span className="font-mono text-eyebrow uppercase text-muted">
                  {listing.soldCount} sold
                </span>
              )}

              <span className="ml-auto flex gap-2">
                {listing.state === 'published' ? (
                  <>
                    <Link href={`/c/${listing.slug}`} className="btn-quiet !px-3 !py-1 !text-xs">
                      View
                    </Link>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        call(`/api/listings/${listing.id}/publish`, {
                          action: 'delist',
                          reason: 'Taken down by the author.',
                        })
                      }
                      className="btn-quiet !px-3 !py-1 !text-xs"
                    >
                      Take down
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !publishable}
                    title={publishable ? undefined : 'This version has not passed verification.'}
                    onClick={() => call(`/api/listings/${listing.id}/publish`, {})}
                    className="btn-seal !px-3 !py-1 !text-xs"
                  >
                    Publish
                  </button>
                )}
              </span>

              {listing.rejectionReason && (
                <p className="w-full font-mono text-xs text-danger">{listing.rejectionReason}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {listings.length === 0 && (
        <details>
          <summary className="cursor-pointer font-mono text-eyebrow uppercase text-muted">
            Create a listing for this version
          </summary>

          <div className="mt-4 grid gap-4 sm:grid-cols-[10rem_12rem_1fr]">
            <label>
              <span className="eyebrow block">Price (IDR)</span>
              <input
                inputMode="numeric"
                value={price}
                onChange={(event) => setPrice(event.target.value.replace(/[^0-9]/g, ''))}
                className="field mt-1.5 tnum"
              />
            </label>

            <label>
              <span className="eyebrow block">Licence</span>
              <select
                value={licenseType}
                onChange={(event) => setLicenseType(event.target.value as LicenseType)}
                className="field mt-1.5"
              >
                {LICENSE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {LICENSES[type].name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="eyebrow block">Summary</span>
              <input
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={400}
                placeholder="One line. Say what kind of puzzle it is, not how to solve it."
                className="field mt-1.5 font-serif"
              />
            </label>
          </div>

          <p className="mt-2 font-serif text-xs leading-relaxed text-muted">
            {LICENSES[licenseType].summary}
            {licenseType === 'unlimited' &&
              ' Buyers on this licence also receive your generator, so they can re-flag it themselves.'}
          </p>

          <button
            type="button"
            disabled={busy || summary.trim().length === 0}
            onClick={() =>
              call('/api/listings', {
                versionId,
                price: Number(price || 0),
                licenseType,
                summary,
              })
            }
            className="btn-primary mt-4"
          >
            {busy ? 'Saving…' : 'Create listing'}
          </button>
        </details>
      )}

      {!publishable && listings.length > 0 && (
        <p className="mt-3 font-serif text-xs leading-relaxed text-muted">
          Publishing is blocked until this exact bundle passes verification. Re-run it, or upload
          a fixed version.
        </p>
      )}
    </div>
  )
}
