import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ListingControls } from '@/components/ListingControls'
import { currentUser } from '@/lib/auth'
import { studioChallenge } from '@/lib/catalog'
import { isAppError } from '@/lib/core/errors'
import { formatDate, formatDuration } from '@/lib/ui/cn'

export const dynamic = 'force-dynamic'

const VERDICT_TONE: Record<string, string> = {
  passed: 'text-verify border-verify/40 bg-verify/[0.06]',
  failed: 'text-danger border-danger/40 bg-danger/[0.06]',
  error: 'text-danger border-danger/40 bg-danger/[0.06]',
  unverified: 'text-muted border-rule',
}

export default async function StudioChallengePage({ params }: { params: { id: string } }) {
  const user = await currentUser()
  if (!user) redirect('/login')

  const challenge = await studioChallenge(params.id, user).catch((error) => {
    if (isAppError(error) && (error.code === 'not_found' || error.code === 'forbidden')) notFound()
    throw error
  })

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <Link href="/sell" className="eyebrow transition-colors hover:text-ink">
        ← Studio
      </Link>
      <h1 className="mt-6 font-sans text-3xl font-semibold tracking-tight">{challenge.title}</h1>
      <p className="mt-2 font-mono text-xs text-muted">
        /c/{challenge.slug} · created {formatDate(challenge.createdAt)}
      </p>

      <section className="mt-10">
        <h2 className="eyebrow">Versions</h2>
        <div className="mt-3 space-y-4">
          {challenge.versions
            .slice()
            .reverse()
            .map((version) => (
              <article key={version.id} className="border border-rule">
                <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule px-4 py-3">
                  <span className="font-sans text-base font-semibold">v{version.ordinal}</span>
                  <span className="font-mono text-xs text-muted">
                    {version.scheme.join(', ')} · {version.difficulty} · {version.flagMode} ·{' '}
                    {version.profile}
                  </span>
                  <span className="ml-auto font-mono text-xs text-muted">
                    <span className="tnum">{version.fileCount}</span> files ·{' '}
                    {formatDate(version.createdAt)}
                  </span>
                </header>

                <div className="px-4 py-3">
                  <p className="break-all font-mono text-[0.6875rem] text-muted">
                    {version.bundleHash}
                  </p>

                  {version.latest ? (
                    <div
                      className={`mt-3 border px-3 py-2 ${VERDICT_TONE[version.latest.verdict] ?? 'border-rule'}`}
                    >
                      <p className="font-mono text-eyebrow uppercase">
                        {version.latest.verdict}
                        {version.latest.runner === 'stub' && ' · no sandbox configured'}
                        {version.latest.durationMs > 0 &&
                          ` · ${formatDuration(version.latest.durationMs)}`}
                      </p>
                      <p className="mt-1.5 font-serif text-sm leading-relaxed">
                        {version.latest.message}
                      </p>
                      {version.latest.log && (
                        <details className="mt-2">
                          <summary className="cursor-pointer font-mono text-eyebrow uppercase text-muted">
                            Solver output
                          </summary>
                          <pre className="mt-2 max-h-64 overflow-auto border border-rule bg-surface p-3 font-mono text-xs leading-relaxed text-muted">
                            {version.latest.log}
                          </pre>
                          <p className="mt-1.5 font-mono text-[0.6875rem] text-muted">
                            Flags are removed from this output before it is stored.
                          </p>
                        </details>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 font-mono text-xs text-muted">Not verified yet.</p>
                  )}

                  <ListingControls
                    versionId={version.id}
                    publishable={version.publishable}
                    listings={challenge.listings.filter(
                      (listing) => listing.versionId === version.id,
                    )}
                  />
                </div>
              </article>
            ))}
        </div>
      </section>
    </div>
  )
}
