'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Balance {
  sellerId: string
  name: string
  payable: number
  payableLabel: string
}

/**
 * Releasing seller funds.
 *
 * Manual by design in v1 — automated disbursement needs KYC onboarding. The
 * reference field is required because a payout line has to be reconstructible
 * against a bank statement later.
 */
export function PayoutControls({ balances }: { balances: Balance[] }) {
  const router = useRouter()
  const [references, setReferences] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function post(body: unknown, key: string) {
    setBusy(key)
    setError(null)
    try {
      const response = await fetch('/api/admin/payouts', {
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
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          disabled={busy === 'mature'}
          onClick={() => post({ action: 'mature' }, 'mature')}
          className="btn-quiet"
        >
          {busy === 'mature' ? 'Checking…' : 'Move closed disputes to payable'}
        </button>
        <p className="font-serif text-xs text-muted">
          Normally a scheduled job. Runs the same code.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 font-mono text-xs text-danger">
          {error}
        </p>
      )}

      {balances.length === 0 ? (
        <p className="mt-4 border border-dashed border-rule px-4 py-6 text-center font-serif text-muted">
          Nothing is payable. Funds move here once a delivery clears its 72-hour dispute window.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {balances.map((balance) => (
            <li key={balance.sellerId} className="flex flex-wrap items-center gap-3 py-3">
              <span className="font-sans text-sm font-medium">{balance.name}</span>
              <span className="font-mono text-sm tabular-nums text-seal">
                {balance.payableLabel}
              </span>
              <input
                value={references[balance.sellerId] ?? ''}
                onChange={(event) =>
                  setReferences((current) => ({
                    ...current,
                    [balance.sellerId]: event.target.value,
                  }))
                }
                placeholder="Bank reference"
                className="field ml-auto w-56"
              />
              <button
                type="button"
                disabled={
                  busy === balance.sellerId ||
                  (references[balance.sellerId] ?? '').trim().length < 3
                }
                onClick={() =>
                  post(
                    {
                      sellerId: balance.sellerId,
                      amount: balance.payable,
                      reference: references[balance.sellerId] ?? '',
                    },
                    balance.sellerId,
                  )
                }
                className="btn-seal"
              >
                {busy === balance.sellerId ? 'Recording…' : 'Mark paid'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
