---
name: changing-the-money-path
description: Use when touching src/lib/commerce/ — orders, the state machine, Midtrans webhooks, escrow, refunds, licenses, or payouts.
---

# Changing the money path

A bug here does not throw an exception. It silently charges the wrong person, delivers
something twice, or leaves funds in a state with no operator action attached.

## Before you edit

Read the transition table in [[commerce]]. It is the specification. If your change needs a
transition that is not in it, the table changes first — in the memory doc and the test — and
the code follows.

## The checklist

- [ ] Is every new transition **idempotent**? Midtrans retries and duplicates. Applying the
      same webhook twice must be a no-op returning 200, not an error and not a double-fulfill.
- [ ] Is the signature verified before **anything** else happens —
      `sha512(order_id + status_code + gross_amount + SERVER_KEY)`?
- [ ] Does any code path advance state from a **client** request rather than a webhook? The
      redirect from checkout triggers a poll, never a transition.
- [ ] Is the amount the server-computed one from order creation? A `gross_amount` off the
      request body verifies a signature and is authoritative for nothing.
- [ ] Is money still an integer in minor units all the way through? No float, no bare `number`
      crossing a plane boundary.
- [ ] Does an illegal transition get **refused and audited**, rather than ignored?
- [ ] If fulfillment can now fail in a new way, does the order land in `fulfill_failed` with an
      operator action — never stranded in `fulfilling`?
- [ ] Are license terms still **snapshotted onto the order**? Editing a listing must never
      change what somebody already bought.
- [ ] Is there an audit entry with an actor for every state change?

## Tests to run

```
npm test -- commerce
npm run typecheck
```

The state machine test is exhaustive: every legal transition asserted to work, and every
illegal one asserted to be refused. Adding a state means adding a full row and column, not a
happy-path case.

Use the signed-webhook test helper rather than loosening signature verification for local
development. That helper exists precisely so nobody is tempted to add a bypass.
