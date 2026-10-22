import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { ordersForBuyer } from '@/lib/commerce'
import { OrderStateTag } from '@/components/OrderStateTag'
import { formatDate } from '@/lib/ui/cn'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your orders — Aya’s Playground' }

export default async function OrdersPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const orders = await ordersForBuyer(user)

  return (
    <div className="mx-auto max-w-shelf px-5 py-12">
      <p className="eyebrow">Your purchases</p>
      <h1 className="mt-4 font-sans text-3xl font-semibold tracking-tight">Orders</h1>

      {orders.length === 0 ? (
        <div className="mt-10 border border-dashed border-rule px-6 py-14 text-center">
          <p className="font-sans text-lg font-medium">You have not bought anything yet.</p>
          <p className="mx-auto mt-3 max-w-prose font-serif leading-relaxed text-muted">
            Every challenge in the catalogue has been solved by our sandbox before it went on
            sale, and your copy comes with its own flag.
          </p>
          <Link href="/" className="btn-seal mt-6">
            Browse the catalogue
          </Link>
        </div>
      ) : (
        <div className="mt-8 border-t border-rule">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="band flex flex-wrap items-baseline gap-x-5 gap-y-2 px-1 py-4"
            >
              <span className="font-sans text-base font-semibold">
                {order.listing?.title ?? 'Removed listing'}
              </span>
              <OrderStateTag state={order.state} label={order.stateLabel} />
              <span className="ml-auto font-mono text-xs text-muted">
                {formatDate(order.createdAt)}
              </span>
              <span className="font-mono text-sm tabular-nums text-seal">{order.priceLabel}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
