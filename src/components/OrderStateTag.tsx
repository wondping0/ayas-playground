import type { OrderState } from '@/lib/core/types'
import { cn } from '@/lib/ui/cn'

/**
 * Order state, coloured by what it means for the buyer rather than by severity:
 * brass while something is still happening, viridian when it is theirs, red
 * only when money did not move as intended.
 */
const TONE: Record<OrderState, string> = {
  created: 'text-muted border-rule',
  awaiting_payment: 'text-seal border-seal/40',
  paid: 'text-seal border-seal/40',
  fulfilling: 'text-seal border-seal/40',
  delivered: 'text-verify border-verify/40',
  fulfill_failed: 'text-danger border-danger/40',
  expired: 'text-muted border-rule',
  failed: 'text-danger border-danger/40',
  cancelled: 'text-muted border-rule',
  refunded: 'text-muted border-rule',
}

export function OrderStateTag({ state, label }: { state: OrderState; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex border px-2 py-0.5 font-mono text-eyebrow uppercase',
        TONE[state],
      )}
    >
      {label}
    </span>
  )
}
