import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { OrderActions } from '@/components/OrderActions'
import { OrderStateTag } from '@/components/OrderStateTag'
import { currentUser } from '@/lib/auth'
import { OfflineMidtransClient, getMidtransClient, orderForBuyer } from '@/lib/commerce'
import { isAppError } from '@/lib/core/errors'
import { formatDate } from '@/lib/ui/cn'

export const dynamic = 'force-dynamic'

export default async function OrderPage({ params }: { params: { id: string } }) {
  const user = await currentUser()
  if (!user) redirect('/login')

  const order = await orderForBuyer(params.id, user).catch((error) => {
    if (isAppError(error) && (error.code === 'not_found' || error.code === 'forbidden')) {
      notFound()
    }
    throw error
  })

  const offlinePayments = getMidtransClient() instanceof OfflineMidtransClient

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/orders" className="eyebrow transition-colors hover:text-ink">
        ← All orders
      </Link>

      <div className="mt-6 flex flex-wrap items-baseline gap-4">
        <h1 className="font-sans text-3xl font-semibold tracking-tight">
          {order.listing?.title ?? 'Removed listing'}
        </h1>
        <OrderStateTag state={order.state} label={order.stateLabel} />
      </div>

      <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-y border-rule py-4 font-mono text-xs">
        <dt className="text-muted">Order</dt>
        <dd className="break-all">{order.id}</dd>
        <dt className="text-muted">Price</dt>
        <dd className="tnum text-seal">{order.priceLabel}</dd>
        <dt className="text-muted">Licence</dt>
        <dd>{order.licenseTerms.name}</dd>
        <dt className="text-muted">Author</dt>
        <dd>{order.sellerName}</dd>
        <dt className="text-muted">Flag format</dt>
        <dd>{order.flagFormat}</dd>
        <dt className="text-muted">Placed</dt>
        <dd>{formatDate(order.createdAt)}</dd>
        {order.paymentType && (
          <>
            <dt className="text-muted">Paid with</dt>
            <dd>{order.paymentType}</dd>
          </>
        )}
        {order.deliveredAt && (
          <>
            <dt className="text-muted">Delivered</dt>
            <dd>{formatDate(order.deliveredAt)}</dd>
          </>
        )}
      </dl>

      <OrderActions order={order} offlinePayments={offlinePayments} />

      <section className="mt-12">
        <h2 className="eyebrow">Your licence</h2>
        <p className="mt-2 font-serif leading-relaxed">{order.licenseTerms.summary}</p>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="font-mono text-eyebrow uppercase text-verify">You may</h3>
            <ul className="mt-2 space-y-1 font-serif text-sm leading-relaxed text-muted">
              {order.licenseTerms.grants.map((grant) => (
                <li key={grant}>{grant}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-mono text-eyebrow uppercase text-danger">You may not</h3>
            <ul className="mt-2 space-y-1 font-serif text-sm leading-relaxed text-muted">
              {order.licenseTerms.restrictions.map((restriction) => (
                <li key={restriction}>{restriction}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-5 border-t border-rule pt-4 font-serif text-sm leading-relaxed text-muted">
          The flag in your bundle was generated for this order and no other. If it turns up
          somewhere it should not, it identifies this purchase — so treat the writeup and the
          solver the way you would treat the flag itself.
        </p>
      </section>
    </div>
  )
}
