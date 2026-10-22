import Link from 'next/link'
import { CipherPlate } from '@/components/CipherPlate'
import { ListingBand } from '@/components/ListingBand'
import { browse, DIFFICULTY_ORDER, SCHEMES } from '@/lib/catalog'
import type { Difficulty } from '@/lib/core/bundle'
import { cn } from '@/lib/ui/cn'

export const dynamic = 'force-dynamic'

interface SearchParams {
  scheme?: string
  difficulty?: string
  q?: string
  sort?: string
}

function isDifficulty(value: string | undefined): value is Difficulty {
  return DIFFICULTY_ORDER.includes(value as Difficulty)
}

export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const scheme = searchParams.scheme
  const difficulty = isDifficulty(searchParams.difficulty) ? searchParams.difficulty : undefined
  const search = searchParams.q?.trim() || undefined
  const sort = (['newest', 'price-asc', 'price-desc', 'rating'] as const).find(
    (option) => option === searchParams.sort,
  )

  const listings = await browse({
    ...(scheme ? { schemes: [scheme] } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(search ? { search } : {}),
    ...(sort ? { sort } : {}),
    limit: 60,
  })

  const filtered = Boolean(scheme || difficulty || search)

  return (
    <>
      <section className="border-b border-rule">
        <div className="mx-auto grid max-w-shelf gap-10 px-5 py-16 sm:py-20 lg:grid-cols-[1fr_20rem] lg:items-center lg:gap-16">
          <div>
            <p className="eyebrow animate-rise">The cryptography challenge marketplace</p>
            <h1 className="mt-5 font-sans text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
              A good challenge.
              <br />
              A playground of possibilities.
            </h1>
            <p className="mt-6 max-w-prose font-serif text-lg leading-relaxed text-muted">
              Find your next CTF puzzle. Get a solver-tested bundle and a writeup.
              Choose a re-flaggable challenge for a flag prepared for your order, then
              bring it to your own event, classroom, or practice session.
            </p>
            <p className="mt-5 max-w-prose font-serif text-lg leading-relaxed text-muted">
              The solution stays sealed. The verification receipt tells you what was checked.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#catalog" className="btn-primary">Explore challenges <span aria-hidden="true">↗</span></a>
              <Link href="/sell/new" className="btn-quiet">Publish your challenge</Link>
            </div>
          </div>

          {/* The thesis, shown rather than described: this is all you get to see. */}
          <div className="relative border border-rule bg-surface p-4 shadow-xl shadow-ink/5">
            <div className="mb-4 flex justify-between gap-3"><span className="eyebrow">Inside the envelope</span><span className="eyebrow">001 / Crypto</span></div>
            <CipherPlate seed="aya-hero" scheme="rsa-weakness" rows={11} width={30} size="lg" />
            <p className="mt-4 text-sm text-muted">A glimpse of the format. Never the solution.</p>
            <p className="mt-2 font-mono text-xs text-muted">Illustrative preview · not a listing</p>
          </div>
        </div>
      </section>

      <section aria-label="How it works" className="mx-auto grid max-w-shelf gap-6 px-5 py-9 md:grid-cols-3">
        {[
          ['01', 'Find your kind of puzzle', 'Compare schemes, difficulty, and verification receipts without revealing the solve.'],
          ['02', 'Make it your own', 'Choose a re-flaggable bundle for an order-specific flag. Static bundles retain their fixed flag.'],
          ['03', 'Bring it to your CTF', 'Download the handout, solver, and writeup. Deploy on your own infrastructure.'],
        ].map(([number, title, description]) => (
          <div key={number} className="border-l-2 border-rule pl-5">
            <span className="font-mono text-xs text-seal">{number}</span>
            <h2 className="mt-2 font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
          </div>
        ))}
      </section>

      <section id="catalog" className="mx-auto max-w-shelf scroll-mt-6 px-5 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-rule pt-10">
          <div><p className="eyebrow">The collection</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Find your next challenge.</h2></div>
          <p className="text-sm text-muted">Cryptography first. Curiosity always.</p>
        </div>
        <form
          method="get"
          className="flex flex-col gap-4 border-b border-rule py-5 lg:flex-row lg:items-end"
        >
          <label className="flex-1">
            <span className="eyebrow block">Search</span>
            <input
              type="search"
              name="q"
              defaultValue={search ?? ''}
              placeholder="shared primes, padding oracle…"
              className="field mt-1.5"
            />
          </label>

          <label>
            <span className="eyebrow block">Scheme</span>
            <select name="scheme" defaultValue={scheme ?? ''} className="field mt-1.5 lg:w-52">
              <option value="">Any scheme</option>
              {SCHEMES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="eyebrow block">Difficulty</span>
            <select
              name="difficulty"
              defaultValue={difficulty ?? ''}
              className="field mt-1.5 lg:w-36"
            >
              <option value="">Any</option>
              {DIFFICULTY_ORDER.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="eyebrow block">Sort</span>
            <select name="sort" defaultValue={sort ?? 'newest'} className="field mt-1.5 lg:w-40">
              <option value="newest">Newest</option>
              <option value="price-asc">Price, low first</option>
              <option value="price-desc">Price, high first</option>
              <option value="rating">Best rated</option>
            </select>
          </label>

          <div className="flex gap-2">
            <button type="submit" className="btn-primary">
              Apply
            </button>
            {filtered && (
              <Link href="/" className="btn-quiet">
                Clear
              </Link>
            )}
          </div>
        </form>

        <p className="py-4 font-mono text-eyebrow uppercase text-muted">
          <span className="tnum text-ink">{listings.length}</span>{' '}
          {listings.length === 1 ? 'challenge' : 'challenges'}
          {filtered ? ' matching' : ' listed'} · all verified
        </p>

        <div className={cn('border-t border-rule', listings.length === 0 && 'border-b')}>
          {listings.map((listing) => (
            <ListingBand key={listing.id} listing={listing} />
          ))}
        </div>

        {listings.length === 0 && (
          <div className="py-16 text-center">
            <p className="font-sans text-lg font-medium">
              {filtered ? 'Nothing matches those filters.' : 'Nothing is listed yet.'}
            </p>
            <p className="mx-auto mt-3 max-w-prose font-serif leading-relaxed text-muted">
              {filtered ? (
                <>
                  Try a broader scheme, or{' '}
                  <Link href="/" className="text-seal underline underline-offset-4">
                    clear the filters
                  </Link>
                  .
                </>
              ) : (
                <>
                  If you have a challenge sitting in a repo from a past event, it needs a{' '}
                  <code className="font-mono text-ink">challenge.yml</code>, a solver, and a
                  writeup to become a listing.
                </>
              )}
            </p>
            {!filtered && (
              <Link href="/sell/new" className="btn-seal mt-6">
                List a challenge
              </Link>
            )}
          </div>
        )}
      </section>
    </>
  )
}
