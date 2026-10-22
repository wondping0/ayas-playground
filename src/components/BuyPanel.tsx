'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { DEFAULT_FLAG_FORMAT } from '@/lib/core/flag-format'

/**
 * Buying.
 *
 * The flag format is asked for here rather than after payment, because it is
 * baked into the bundle at fulfilment and cannot be changed afterwards. Most
 * buyers keep the default; an organiser running their own event wants their own
 * prefix.
 */
export function BuyPanel({
  listingId,
  priceLabel,
  signedIn,
  ownListing,
  reflaggable,
}: {
  listingId: string
  priceLabel: string
  signedIn: boolean
  ownListing: boolean
  reflaggable: boolean
}) {
  const router = useRouter()
  const [flagFormat, setFlagFormat] = useState(DEFAULT_FLAG_FORMAT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preview = flagFormat.includes('%s')
    ? flagFormat.replace('%s', 'a7k2m9p4x1c8v5n3b6qz')
    : null

  async function buy() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, flagFormat }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not start checkout.')
        return
      }
      router.push(`/orders/${body.order.id}`)
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (ownListing) {
    return (
      <div className="mt-8 border border-rule px-4 py-3">
        <p className="font-serif text-sm text-muted">
          This is your listing. Manage it from{' '}
          <Link href="/sell" className="text-seal underline underline-offset-4">
            your studio
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="mt-8 border border-ink bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="eyebrow">One challenge, one licence</p>
        <p className="font-mono text-2xl font-medium tabular-nums text-seal">{priceLabel}</p>
      </div>

      {reflaggable ? (
        <>
          <label className="mt-5 block">
            <span className="eyebrow block">Your flag format</span>
            <input
              type="text"
              value={flagFormat}
              onChange={(event) => setFlagFormat(event.target.value)}
              className="field mt-1.5"
              spellCheck={false}
              aria-describedby="flag-format-help"
            />
          </label>
          <p id="flag-format-help" className="mt-2 font-mono text-xs text-muted">
            {preview ? (
              <>
                Your copy will use <span className="text-ink">{preview}</span>
              </>
            ) : (
              <span className="text-danger">Include %s where the random part should go.</span>
            )}
          </p>
        </>
      ) : (
        <p className="mt-5 border border-rule px-3 py-2 font-serif text-sm leading-relaxed text-muted">
          <span className="font-mono text-eyebrow uppercase text-seal">Fixed flag</span>
          <br />
          This challenge cannot be re-flagged, so every buyer receives the same flag and you
          cannot choose its format. If it has been run at an event before, assume players have
          seen it.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 border border-danger/40 bg-danger/[0.06] px-3 py-2 font-mono text-xs text-danger">
          {error}
        </p>
      )}

      {signedIn ? (
        <button
          type="button"
          onClick={buy}
          disabled={busy || (reflaggable && !preview)}
          className="btn-seal mt-5 w-full"
        >
          {busy ? 'Starting checkout…' : `Buy — ${priceLabel}`}
        </button>
      ) : (
        <Link href={`/login?next=/c`} className="btn-primary mt-5 w-full">
          Sign in to buy
        </Link>
      )}

      <p className="mt-4 font-serif text-xs leading-relaxed text-muted">
        Pay with QRIS, GoPay, virtual account, or bank transfer. Your copy is built after payment
        clears — usually a few seconds, longer for heavy challenges.
      </p>
    </div>
  )
}
