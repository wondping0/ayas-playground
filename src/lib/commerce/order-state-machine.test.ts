import { describe, expect, it } from 'vitest'
import { AppError } from '@/lib/core/errors'
import { ORDER_STATES, type OrderState } from '@/lib/core/types'
import {
  FUNDS_HELD_STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  assertTransition,
  canTransition,
  isIdempotentRepeat,
  isStale,
  isTerminal,
} from './order-state-machine'

/**
 * Exhaustive by construction.
 *
 * Every ordered pair of states is checked against the table, so adding a state
 * without adding its row and its edges fails here rather than in production.
 */

const LEGAL = new Set<string>()
for (const from of ORDER_STATES) {
  for (const to of TRANSITIONS[from]) LEGAL.add(`${from}->${to}`)
}

const ALL_PAIRS: Array<[OrderState, OrderState]> = ORDER_STATES.flatMap((from) =>
  ORDER_STATES.map((to) => [from, to] as [OrderState, OrderState]),
)

describe('the transition table covers every state', () => {
  it('has a row for each state', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...ORDER_STATES].sort())
  })

  it('only names states that exist', () => {
    for (const from of ORDER_STATES) {
      for (const to of TRANSITIONS[from]) {
        expect(ORDER_STATES).toContain(to)
      }
    }
  })

  it('lists no state twice in a row', () => {
    for (const from of ORDER_STATES) {
      expect(new Set(TRANSITIONS[from]).size).toBe(TRANSITIONS[from].length)
    }
  })

  it('has no self-transitions — a repeat is idempotence, not a move', () => {
    for (const from of ORDER_STATES) {
      expect(TRANSITIONS[from]).not.toContain(from)
    }
  })
})

describe('every ordered pair of states', () => {
  it.each(ALL_PAIRS)('%s -> %s matches the table', (from, to) => {
    const expected = LEGAL.has(`${from}->${to}`)
    expect(canTransition(from, to)).toBe(expected)
    if (expected) {
      expect(() => assertTransition(from, to)).not.toThrow()
    } else {
      expect(() => assertTransition(from, to)).toThrow(AppError)
    }
  })
})

describe('the legal transitions are the intended ones', () => {
  const EXPECTED: Array<[OrderState, OrderState]> = [
    ['created', 'awaiting_payment'],
    ['created', 'expired'],
    ['created', 'cancelled'],
    ['created', 'failed'],
    ['awaiting_payment', 'paid'],
    ['awaiting_payment', 'expired'],
    ['awaiting_payment', 'failed'],
    ['awaiting_payment', 'cancelled'],
    ['paid', 'fulfilling'],
    ['paid', 'refunded'],
    ['fulfilling', 'delivered'],
    ['fulfilling', 'fulfill_failed'],
    ['fulfill_failed', 'fulfilling'],
    ['fulfill_failed', 'refunded'],
    ['delivered', 'refunded'],
  ]

  it('permits exactly these and nothing else', () => {
    expect([...LEGAL].sort()).toEqual(EXPECTED.map(([f, t]) => `${f}->${t}`).sort())
  })
})

describe('terminal states', () => {
  it('are the four that end an order', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(['cancelled', 'expired', 'failed', 'refunded'])
  })

  it.each(TERMINAL_STATES)('%s allows no onward transition', (state) => {
    for (const to of ORDER_STATES) {
      expect(canTransition(state, to)).toBe(false)
    }
    expect(isTerminal(state)).toBe(true)
  })

  it('delivered is not terminal — a refund is still possible in the window', () => {
    expect(isTerminal('delivered')).toBe(false)
    expect(canTransition('delivered', 'refunded')).toBe(true)
  })
})

describe('money safety properties', () => {
  it('every state holding funds can reach a refund', () => {
    for (const state of FUNDS_HELD_STATES) {
      const reachable = new Set<OrderState>()
      const queue: OrderState[] = [state]
      while (queue.length > 0) {
        const current = queue.pop()!
        for (const next of TRANSITIONS[current]) {
          if (!reachable.has(next)) {
            reachable.add(next)
            queue.push(next)
          }
        }
      }
      expect(reachable.has('refunded')).toBe(true)
    }
  })

  it('a paid order can never reach expired, failed, or cancelled', () => {
    // Those states mean "no money changed hands". Reaching one after payment
    // would strand the buyer's funds outside every reconciliation query.
    const reachable = new Set<OrderState>(['paid'])
    const queue: OrderState[] = ['paid']
    while (queue.length > 0) {
      const current = queue.pop()!
      for (const next of TRANSITIONS[current]) {
        if (!reachable.has(next)) {
          reachable.add(next)
          queue.push(next)
        }
      }
    }
    expect(reachable.has('expired')).toBe(false)
    expect(reachable.has('failed')).toBe(false)
    expect(reachable.has('cancelled')).toBe(false)
  })

  it('fulfilling always has an exit', () => {
    // A sandbox failure after payment must never strand an order.
    expect(TRANSITIONS.fulfilling.length).toBeGreaterThan(0)
    expect(TRANSITIONS.fulfill_failed.length).toBeGreaterThan(0)
  })

  it('every non-terminal state can reach a terminal one', () => {
    for (const start of ORDER_STATES) {
      const reachable = new Set<OrderState>()
      const queue: OrderState[] = [start]
      while (queue.length > 0) {
        const current = queue.pop()!
        for (const next of TRANSITIONS[current]) {
          if (!reachable.has(next)) {
            reachable.add(next)
            queue.push(next)
          }
        }
      }
      const ends = isTerminal(start) || [...reachable].some(isTerminal)
      expect(ends).toBe(true)
    }
  })
})

describe('idempotence and ordering', () => {
  it.each(ORDER_STATES)('treats %s -> itself as a repeat', (state) => {
    expect(isIdempotentRepeat(state, state)).toBe(true)
  })

  it('does not treat a different state as a repeat', () => {
    expect(isIdempotentRepeat('paid', 'delivered')).toBe(false)
  })

  it('recognises a notification that arrives after later progress', () => {
    // A `settlement` webhook redelivered after fulfilment must not rewind.
    expect(isStale('delivered', 'paid')).toBe(true)
    expect(isStale('fulfilling', 'paid')).toBe(true)
    expect(isStale('paid', 'awaiting_payment')).toBe(true)
  })

  it('does not call forward progress stale', () => {
    expect(isStale('paid', 'delivered')).toBe(false)
    expect(isStale('awaiting_payment', 'paid')).toBe(false)
  })

  it('says nothing about states outside the progress line', () => {
    expect(isStale('delivered', 'refunded')).toBe(false)
    expect(isStale('refunded', 'paid')).toBe(false)
  })
})
