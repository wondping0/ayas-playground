import Link from 'next/link'
import type { Role } from '@/lib/core/types'

interface SiteHeaderProps {
  user: { name: string; roles: Role[] } | null
}

export function SiteHeader({ user }: SiteHeaderProps) {
  const isSeller = user?.roles.includes('seller') ?? false
  const isAdmin = user?.roles.includes('admin') ?? false

  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-shelf flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <Link href="/" className="group flex items-baseline gap-2">
          <span className="font-sans text-base font-semibold tracking-tight">
            Aya&rsquo;s Playground
          </span>
          <span className="hidden font-mono text-eyebrow uppercase text-seal sm:inline">
            sealed goods
          </span>
        </Link>

        <nav aria-label="Main navigation" className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs uppercase sm:ml-auto sm:w-auto">
          <Link href="/" className="text-muted transition-colors hover:text-ink">
            Browse
          </Link>
          {user ? (
            <>
              <Link href="/orders" className="text-muted transition-colors hover:text-ink">
                Orders
              </Link>
              {isSeller && (
                <Link href="/sell" className="text-muted transition-colors hover:text-ink">
                  Sell
                </Link>
              )}
              {isAdmin && (
                <Link href="/admin" className="text-muted transition-colors hover:text-ink">
                  Admin
                </Link>
              )}
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="text-muted uppercase transition-colors hover:text-ink"
                >
                  Sign out
                </button>
              </form>
              <span className="hidden border-l border-rule pl-5 text-ink sm:inline">
                {user.name}
              </span>
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted transition-colors hover:text-ink">
                Sign in
              </Link>
              <Link href="/register" className="btn-primary !px-3 !py-1.5 !text-eyebrow uppercase">
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
