import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { studioChallenges } from '@/lib/catalog'
import { balanceFor, salesForSeller } from '@/lib/commerce'
import { formatDate, formatIdr } from '@/lib/ui/cn'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Seller studio — Aya’s Playground' }

const VERDICT_TONE: Record<string, string> = {
  passed: 'text-verify',
  failed: 'text-danger',
  error: 'text-danger',
  unverified: 'text-muted',
}

export default async function SellPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!user.roles.includes('seller')) {
    return (
      <div className="mx-auto max-w-prose px-5 py-20">
        <h1 className="font-sans text-3xl font-semibold tracking-tight">Selling is not enabled</h1>
        <p className="mt-4 font-serif leading-relaxed text-muted">
          Your account can buy challenges but not list them. Ask an administrator to add the
          seller role.
        </p>
      </div>
    )
  }

  const [challenges, balance, sales] = await Promise.all([
    studioChallenges(user),
    balanceFor(user.id),
    salesForSeller(user),
  ])

  const delivered = sales.filter((sale) => sale.state === 'delivered')

  return (
    <div className="mx-auto max-w-shelf px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Seller studio</p>
          <h1 className="mt-4 font-sans text-3xl font-semibold tracking-tight">
            Your challenges
          </h1>
        </div>
        <Link href="/sell/new" className="btn-seal">
          Upload a bundle
        </Link>
      </div>

      <section className="mt-10 grid gap-px border border-rule bg-rule sm:grid-cols-3">
        <Figure label="Held until the dispute window closes" value={formatIdr(balance.pending)} />
        <Figure label="Ready to pay out" value={formatIdr(balance.payable)} tone="seal" />
        <Figure label="Paid out so far" value={formatIdr(balance.paid)} />
      </section>

      {challenges.length === 0 ? (
        <div className="mt-10 border border-dashed border-rule px-6 py-14 text-center">
          <p className="font-sans text-lg font-medium">Nothing uploaded yet.</p>
          <p className="mx-auto mt-3 max-w-prose font-serif leading-relaxed text-muted">
            A sellable bundle is a <code className="font-mono text-ink">challenge.yml</code>, the
            handout in <code className="font-mono text-ink">release_files/</code>, a solver that
            prints the flag, and a writeup. If your challenge re-generates its output from a flag,
            put that script in <code className="font-mono text-ink">server_files/</code> and every
            buyer gets their own.
          </p>
          <Link href="/sell/new" className="btn-seal mt-6">
            Upload a bundle
          </Link>
        </div>
      ) : (
        <div className="mt-10 border-t border-rule">
          {challenges.map((challenge) => {
            const newest = challenge.versions[challenge.versions.length - 1]
            const live = challenge.listings.filter((listing) => listing.state === 'published')
            return (
              <Link
                key={challenge.id}
                href={`/sell/${challenge.id}`}
                className="band block px-1 py-5"
              >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h2 className="font-sans text-lg font-semibold">{challenge.title}</h2>
                  {newest?.latest && (
                    <span
                      className={`font-mono text-eyebrow uppercase ${VERDICT_TONE[newest.latest.verdict] ?? 'text-muted'}`}
                    >
                      {newest.latest.verdict}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-xs text-muted">
                    v{newest?.ordinal ?? 1} · {formatDate(challenge.createdAt)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-muted">
                  {live.length > 0 ? (
                    <>
                      <span className="text-verify">live</span> at {formatIdr(live[0]!.price)}
                    </>
                  ) : challenge.listings.length > 0 ? (
                    'listed but not published'
                  ) : (
                    'no listing yet'
                  )}
                  {' · '}
                  <span className="tnum">{challenge.versions.length}</span> version
                  {challenge.versions.length === 1 ? '' : 's'}
                </p>
              </Link>
            )
          })}
        </div>
      )}

      {delivered.length > 0 && (
        <section className="mt-14">
          <h2 className="eyebrow">Sales</h2>
          <table className="mt-3 w-full border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-y border-rule text-muted">
                <th className="py-2 font-normal">Challenge</th>
                <th className="py-2 font-normal">Buyer</th>
                <th className="py-2 text-right font-normal">Gross</th>
                <th className="py-2 text-right font-normal">Your share</th>
                <th className="py-2 text-right font-normal">Date</th>
              </tr>
            </thead>
            <tbody>
              {delivered.map((sale) => (
                <tr key={sale.id} className="border-b border-rule">
                  <td className="py-2">{sale.listingTitle}</td>
                  <td className="py-2 text-muted">{sale.buyerName}</td>
                  <td className="py-2 text-right tabular-nums">{formatIdr(sale.gross)}</td>
                  <td className="py-2 text-right tabular-nums text-seal">{formatIdr(sale.net)}</td>
                  <td className="py-2 text-right text-muted">{formatDate(sale.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'seal' }) {
  return (
    <div className="bg-paper px-5 py-4">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-2 font-mono text-2xl tabular-nums ${tone === 'seal' ? 'text-seal' : 'text-ink'}`}
      >
        {value}
      </p>
    </div>
  )
}
