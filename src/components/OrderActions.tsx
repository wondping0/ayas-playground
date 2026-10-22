'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { OrderView } from '@/lib/commerce'

/**
 * What the buyer can do next, and nothing else.
 *
 * Each state shows exactly one action, because at any point there is only one
 * thing that makes sense to do. While a copy is being built the page polls,
 * since the build is a queued sandbox job and there is nothing to click.
 */
export function OrderActions({
  order,
  offlinePayments,
}: {
  order: OrderView
  offlinePayments: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const building = order.state === 'paid' || order.state === 'fulfilling'

  useEffect(() => {
    if (!building) return
    const timer = setInterval(() => router.refresh(), 2_000)
    return () => clearInterval(timer)
  }, [building, router])

  async function post(url: string, body: unknown) {
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
        return false
      }
      router.refresh()
      return true
    } catch {
      setError('Could not reach the server. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/orders/${order.id}/download`)
      const payload = await response.json()
      if (!response.ok) {
        setError(payload?.error?.message ?? 'Could not start the download.')
        return
      }
      window.location.href = `/api/orders/${order.id}/download?token=${encodeURIComponent(payload.token)}`
      setTimeout(() => router.refresh(), 1_500)
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8">
      {error && (
        <p
          role="alert"
          className="mb-4 border border-danger/40 bg-danger/[0.06] px-3 py-2 font-mono text-xs text-danger"
        >
          {error}
        </p>
      )}

      {order.state === 'awaiting_payment' && (
        <section className="border border-ink bg-surface p-5">
          <h2 className="font-sans text-lg font-semibold">Pay to receive your copy</h2>
          <p className="mt-2 font-serif leading-relaxed text-muted">
            Your bundle is built after payment clears. QRIS and e-wallets are usually instant;
            a bank transfer can take longer, and this page will update when it arrives.
          </p>

          {offlinePayments ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => post('/api/payments/offline', { orderId: order.id })}
                className="btn-seal mt-5"
              >
                {busy ? 'Settling…' : `Simulate payment — ${order.priceLabel}`}
              </button>
              <p className="mt-3 font-mono text-xs text-muted">
                No Midtrans key is configured, so this sends a correctly signed notification
                through the real webhook handler.
              </p>
            </>
          ) : (
            <a
              href={order.snapRedirectUrl ?? '#'}
              className="btn-seal mt-5"
              rel="noreferrer noopener"
            >
              Pay {order.priceLabel}
            </a>
          )}
        </section>
      )}

      {building && (
        <section className="border border-seal/40 bg-seal/[0.06] p-5">
          <h2 className="font-sans text-lg font-semibold text-seal">Building your copy</h2>
          <p className="mt-2 max-w-prose font-serif leading-relaxed text-muted">
            We are running the author&rsquo;s generator with your flag, in a sandbox. This takes a
            few seconds for most challenges. The page will update on its own.
          </p>
        </section>
      )}

      {order.state === 'delivered' && order.delivery && (
        <section className="border border-verify/40 bg-verify/[0.06] p-5">
          <h2 className="font-sans text-lg font-semibold text-verify">Your copy is ready</h2>
          <p className="mt-2 font-mono text-xs text-muted">
            {(order.delivery.sizeBytes / 1024).toFixed(1)} KB ·{' '}
            <span className="tnum">{order.delivery.downloadsLeft}</span> downloads left
          </p>
          <button type="button" disabled={busy} onClick={download} className="btn-seal mt-5">
            {busy ? 'Preparing…' : 'Download bundle'}
          </button>
          <p className="mt-3 font-serif text-sm leading-relaxed text-muted">
            The folder is ctfcli-shaped — run <code className="font-mono text-ink">ctf challenge install .</code>{' '}
            to push it straight into your own CTFd.
          </p>
        </section>
      )}

      {order.state === 'fulfill_failed' && (
        <section className="border border-danger/40 bg-danger/[0.06] p-5">
          <h2 className="font-sans text-lg font-semibold text-danger">The build did not finish</h2>
          <p className="mt-2 max-w-prose font-serif leading-relaxed text-muted">
            Your payment went through, but generating your copy failed. We retry automatically,
            and an operator can refund you if it keeps failing.
          </p>
          {order.failureReason && (
            <pre className="mt-4 overflow-x-auto border border-danger/25 bg-surface p-3 font-mono text-xs text-muted">
              {order.failureReason}
            </pre>
          )}
        </section>
      )}

      {order.state === 'delivered' && !order.reviewed && <ReviewForm orderId={order.id} />}

      {order.reviewed && (
        <p className="mt-6 font-mono text-eyebrow uppercase text-muted">
          Thanks — your review is published.
        </p>
      )}
    </div>
  )
}

function ReviewForm({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [rating, setRating] = useState(5)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, rating, body }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setError(payload?.error?.message ?? 'Could not post the review.')
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 border border-rule p-5">
      <h2 className="eyebrow">Rate this challenge</h2>
      <p className="mt-2 font-serif text-sm leading-relaxed text-muted">
        Only buyers can review, so yours is worth something. Was it what the scheme tag promised?
      </p>

      <div className="mt-4 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            aria-label={`${value} of 5`}
            aria-pressed={rating === value}
            className={`px-1 font-mono text-2xl leading-none transition-colors ${
              value <= rating ? 'text-seal' : 'text-rule hover:text-seal/50'
            }`}
          >
            ★
          </button>
        ))}
      </div>

      <label className="mt-4 block">
        <span className="eyebrow block">Notes (optional)</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          maxLength={2000}
          className="field mt-1.5 font-serif"
          placeholder="Did it fit the slot you needed? Anything an organiser should know?"
        />
      </label>

      {error && (
        <p role="alert" className="mt-3 font-mono text-xs text-danger">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="btn-primary mt-4">
        {busy ? 'Posting…' : 'Post review'}
      </button>
    </form>
  )
}
