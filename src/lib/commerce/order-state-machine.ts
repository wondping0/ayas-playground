import { AppError } from '@/lib/core/errors'
import { ORDER_STATES, type OrderState } from '@/lib/core/types'

/**
 * The order state machine.
 *
 * This table is the specification, and it is mirrored in
 * .wondev/memory/commerce.md. A transition that is not here does not happen —
 * it is refused and audited, never quietly applied.
 *
 * Money moves through these edges, so the test file walks every pair of states
 * in both directions rather than sampling.
 */
export const TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  created: ['awaiting_payment', 'expired', 'cancelled', 'failed'],
  awaiting_payment: ['paid', 'expired', 'failed', 'cancelled'],
  paid: ['fulfilling', 'refunded'],
  fulfilling: ['delivered', 'fulfill_failed'],
  // A failure after payment always has an operator action attached: try again,
  // or give the money back. It is never left to sit.
  fulfill_failed: ['fulfilling', 'refunded'],
  delivered: ['refunded'],
  expired: [],
  failed: [],
  cancelled: [],
  refunded: [],
}

export const TERMINAL_STATES: readonly OrderState[] = ORDER_STATES.filter(
  (state) => TRANSITIONS[state].length === 0,
)

/** States in which the buyer's money is held by the platform. */
export const FUNDS_HELD_STATES: readonly OrderState[] = [
  'paid',
  'fulfilling',
  'fulfill_failed',
  'delivered',
]

export function isTerminal(state: OrderState): boolean {
  return TRANSITIONS[state].length === 0
}

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: OrderState, to: OrderState): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      'illegal_transition',
      `An order cannot move from "${from}" to "${to}".`,
      { details: { from, to, allowed: TRANSITIONS[from] } },
    )
  }
}

/**
 * Classify a webhook that asks for a transition already applied.
 *
 * Midtrans retries and duplicates, so `paid -> paid` is the normal case, not an
 * error: it means an earlier delivery of the same notification already did the
 * work. The caller returns 200 and does nothing.
 */
export function isIdempotentRepeat(current: OrderState, requested: OrderState): boolean {
  return current === requested
}

/**
 * Whether a later state has already been reached.
 *
 * Notifications can arrive out of order — a `settlement` after the order has
 * already been fulfilled and delivered. Moving backwards would undo real work,
 * so a stale notification is dropped rather than applied.
 */
const PROGRESS_ORDER: readonly OrderState[] = [
  'created',
  'awaiting_payment',
  'paid',
  'fulfilling',
  'delivered',
]

export function isStale(current: OrderState, requested: OrderState): boolean {
  const currentIndex = PROGRESS_ORDER.indexOf(current)
  const requestedIndex = PROGRESS_ORDER.indexOf(requested)
  if (currentIndex === -1 || requestedIndex === -1) return false
  return requestedIndex < currentIndex
}
