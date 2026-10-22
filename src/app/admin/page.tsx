import { redirect } from 'next/navigation'
import { PayoutControls } from '@/components/PayoutControls'
import { currentUser } from '@/lib/auth'
import { recentAudit } from '@/lib/audit'
import { pendingReleases } from '@/lib/commerce'
import { getStore } from '@/lib/store'
import { formatIdr } from '@/lib/ui/cn'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin — Aya’s Playground' }

export default async function AdminPage() {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!user.roles.includes('admin')) redirect('/')

  const [balances, audit] = await Promise.all([pendingReleases(), recentAudit(user, 120)])

  const store = getStore()
  const named = await Promise.all(
    balances.map(async (balance) => ({
      ...balance,
      name: (await store.users.get(balance.sellerId))?.name ?? balance.sellerId,
    })),
  )

  return (
    <div className="mx-auto max-w-shelf px-5 py-12">
      <p className="eyebrow">Operations</p>
      <h1 className="mt-4 font-sans text-3xl font-semibold tracking-tight">Admin</h1>

      <section className="mt-10">
        <h2 className="eyebrow">Payouts ready to release</h2>
        <PayoutControls
          balances={named.map((balance) => ({
            sellerId: balance.sellerId,
            name: balance.name,
            payable: balance.payable,
            payableLabel: formatIdr(balance.payable),
          }))}
        />
      </section>

      <section className="mt-14">
        <h2 className="eyebrow">Audit trail</h2>
        <p className="mt-2 font-serif text-sm leading-relaxed text-muted">
          Append-only. Never contains a flag, a solver body, or a secret.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-y border-rule text-muted">
                <th className="py-2 pr-4 font-normal">When</th>
                <th className="py-2 pr-4 font-normal">Actor</th>
                <th className="py-2 pr-4 font-normal">Action</th>
                <th className="py-2 pr-4 font-normal">Subject</th>
                <th className="py-2 font-normal">Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((row) => (
                <tr key={row.id} className="border-b border-rule align-top">
                  <td className="py-2 pr-4 text-muted">
                    {new Date(row.createdAt).toLocaleString('en-GB')}
                  </td>
                  <td className="py-2 pr-4">{row.actorName}</td>
                  <td className="py-2 pr-4 text-seal">{row.action}</td>
                  <td className="py-2 pr-4 text-muted">
                    {row.subjectType}/{row.subjectId.slice(0, 12)}…
                  </td>
                  <td className="py-2 text-muted">
                    {Object.entries(row.detail)
                      .map(([key, value]) => `${key}=${String(value).slice(0, 40)}`)
                      .join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 && (
            <p className="py-8 text-center font-serif text-muted">Nothing has happened yet.</p>
          )}
        </div>
      </section>
    </div>
  )
}
