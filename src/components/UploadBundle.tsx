'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Result {
  challenge: { id: string; title: string }
  version: { id: string; ordinal: number }
  verification: { verdict: string; message: string; durationMs: number; runner: string }
}

/**
 * Upload, then verify, in one step.
 *
 * Verification is what a seller came for — a separate "now verify it" button
 * would be a second thing to learn for no benefit. The verdict is shown in
 * full, including a failure message, because that is what tells them what to fix.
 */
export function UploadBundle() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([])
  const [result, setResult] = useState<Result | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setIssues([])
    setResult(null)

    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/challenges', { method: 'POST', body: form })
      const body = await response.json()
      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not read that bundle.')
        const found = body?.error?.details?.issues
        if (Array.isArray(found)) setIssues(found)
        return
      }
      setResult(body as Result)
      router.refresh()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const passed = result?.verification.verdict === 'passed'

  return (
    <>
      <form onSubmit={submit} className="mt-8 border border-ink bg-surface p-5">
        <label className="block">
          <span className="eyebrow block">Bundle (.zip)</span>
          <input
            type="file"
            name="bundle"
            accept=".zip,application/zip"
            required
            className="field mt-1.5 file:mr-3 file:border-0 file:bg-ink file:px-3 file:py-1 file:font-sans file:text-xs file:text-paper"
          />
        </label>

        <button type="submit" disabled={busy} className="btn-primary mt-5">
          {busy ? 'Verifying…' : 'Upload and verify'}
        </button>

        {busy && (
          <p className="mt-3 font-mono text-xs text-muted">
            Building with a throwaway flag, then running your solver against it.
          </p>
        )}
      </form>

      {error && (
        <div
          role="alert"
          className="mt-6 border border-danger/40 bg-danger/[0.06] p-5"
        >
          <h2 className="font-sans text-lg font-semibold text-danger">That bundle was rejected</h2>
          <p className="mt-2 font-serif leading-relaxed">{error}</p>
          {issues.length > 0 && (
            <ul className="mt-4 space-y-1 font-mono text-xs">
              {issues.map((issue) => (
                <li key={`${issue.path}-${issue.message}`}>
                  <span className="text-danger">{issue.path}</span>{' '}
                  <span className="text-muted">— {issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <div
          className={`mt-6 border p-5 ${
            passed ? 'border-verify/40 bg-verify/[0.06]' : 'border-danger/40 bg-danger/[0.06]'
          }`}
        >
          <h2
            className={`font-sans text-lg font-semibold ${passed ? 'text-verify' : 'text-danger'}`}
          >
            {passed
              ? 'Solved — this challenge can go on sale'
              : `Verification ${result.verification.verdict}`}
          </h2>
          <p className="mt-2 font-serif leading-relaxed">{result.verification.message}</p>

          {result.verification.runner === 'stub' && (
            <p className="mt-3 border border-rule bg-surface px-3 py-2 font-mono text-xs text-muted">
              No sandbox is configured on this server, so nothing was executed. Set
              AYA_RUNNER=docker to verify for real — a listing cannot be published until it is.
            </p>
          )}

          <a href={`/sell/${result.challenge.id}`} className="btn-primary mt-5">
            {passed ? 'Set a price and publish' : 'Open the challenge'}
          </a>
        </div>
      )}
    </>
  )
}
