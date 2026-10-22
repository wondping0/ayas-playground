'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seller, setSeller] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const form = new FormData(event.currentTarget)
    const payload = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      ...(mode === 'register' ? { name: String(form.get('name') ?? ''), seller } : {}),
    }

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body?.error?.message ?? 'That did not work.')
        return
      }
      router.push('/')
      router.refresh()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      {mode === 'register' && (
        <label className="block">
          <span className="eyebrow block">Display name</span>
          <input name="name" required maxLength={80} className="field mt-1.5" autoComplete="name" />
          <span className="mt-1.5 block font-mono text-xs text-muted">
            Shown on your listings, and in the licence of everything you sell.
          </span>
        </label>
      )}

      <label className="block">
        <span className="eyebrow block">Email</span>
        <input
          name="email"
          type="email"
          required
          className="field mt-1.5"
          autoComplete="email"
        />
      </label>

      <label className="block">
        <span className="eyebrow block">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={mode === 'register' ? 10 : 1}
          className="field mt-1.5"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
        {mode === 'register' && (
          <span className="mt-1.5 block font-mono text-xs text-muted">
            At least 10 characters.
          </span>
        )}
      </label>

      {mode === 'register' && (
        <label className="flex items-start gap-3 border border-rule px-4 py-3">
          <input
            type="checkbox"
            checked={seller}
            onChange={(event) => setSeller(event.target.checked)}
            className="mt-1 accent-[rgb(var(--seal))]"
          />
          <span>
            <span className="block font-sans text-sm font-medium">I want to sell challenges</span>
            <span className="mt-0.5 block font-serif text-xs leading-relaxed text-muted">
              Adds the seller studio, where you upload bundles and list them.
            </span>
          </span>
        </label>
      )}

      {error && (
        <p
          role="alert"
          className="border border-danger/40 bg-danger/[0.06] px-3 py-2 font-mono text-xs text-danger"
        >
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>

      <p className="font-mono text-xs text-muted">
        {mode === 'login' ? (
          <>
            No account?{' '}
            <Link href="/register" className="text-seal underline underline-offset-4">
              Create one
            </Link>
          </>
        ) : (
          <>
            Already have one?{' '}
            <Link href="/login" className="text-seal underline underline-offset-4">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  )
}
