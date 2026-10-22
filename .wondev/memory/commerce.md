---
title: Commerce — orders, Midtrans, escrow, licensing
always: false
description: The order state machine, Midtrans webhook handling, escrow and payout rules — read before touching anything that moves money
verified: 2026-09-02
verifiedAgainst: src/lib/commerce/order-state-machine.ts (table matches row for row) and its exhaustive test over all 100 state pairs
---

# Commerce

## Order state machine

States, and the only legal transitions. Anything not in this table is refused and audited.

| From | To | Trigger |
| ---- | -- | ------- |
| `created` | `awaiting_payment` | Midtrans Snap token issued |
| `created` | `expired` / `cancelled` / `failed` | checkout never got a token — TTL, buyer, or provider |
| `awaiting_payment` | `paid` | webhook `settlement` / `capture` (accept) |
| `awaiting_payment` | `expired` | webhook `expire`, or TTL reached |
| `awaiting_payment` | `failed` | webhook `deny` / `cancel` |
| `awaiting_payment` | `cancelled` | buyer cancels |
| `paid` | `fulfilling` | fulfillment job enqueued |
| `fulfilling` | `delivered` | artifact written, download token issued |
| `fulfilling` | `fulfill_failed` | sandbox error after retries exhausted |
| `fulfill_failed` | `fulfilling` | admin or automatic retry |
| `fulfill_failed` | `refunded` | give up, return funds |
| `paid` | `refunded` | refund before fulfillment |
| `delivered` | `refunded` | refund inside the dispute window |

`delivered` is terminal once the dispute window closes. `refunded`, `expired`, `failed`, and
`cancelled` are terminal.

**Fulfillment can fail after payment has succeeded.** That is not an edge case — it is the
normal consequence of running a generator in a sandbox on the order path, and
`fulfill_failed` exists so that money never sits in a state with no operator action attached
to it.

## Midtrans

Snap checkout: QRIS, GoPay, virtual account, bank transfer.

- **Signature is mandatory:** `sha512(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)`.
  A request that fails it is dropped and audited, never processed.
- **The webhook is the only source of truth.** The browser returning from the payment page
  triggers a *poll*, never a transition.
- `transaction_status` mapping: `settlement`/`capture` (with `fraud_status: accept`) → `paid`;
  `pending` → stay; `deny`/`cancel` → `failed`; `expire` → `expired`.
- `capture` with `fraud_status: challenge` stays pending and is surfaced to an admin.
- Webhooks **duplicate and arrive out of order.** Handling is idempotent: re-applying a
  transition already applied is a no-op returning 200, not an error and not a double-fulfill.
- The amount charged is the server-computed amount from order creation. A `gross_amount` in a
  webhook body is used for signature verification, never as an authority on price.

## Money representation

Integer IDR minor units, everywhere, in a branded type. No floats. No bare `number` crossing
a plane boundary.

## Escrow and payouts

Funds sit in `pending` on the seller's balance from `delivered` until the **72h dispute
window** closes, then move to `payable`. Platform commission is deducted at that transition
and recorded, so a payout line is always reconstructible.

Payout release is manual in v1: an admin marks a payable balance paid and records a reference.
Automated disbursement means KYC onboarding and is not worth it before there is volume.

An order is stamped `payoutMaturedAt` **before** its balance moves, so a crash between the two
cannot double-credit a seller. `listDisputeWindowClosed` filters on that stamp, which is what
makes `maturePayouts` safe to run on a timer and safe to run twice.

## Licensing

| Type | Grants |
| ---- | ------ |
| `practice` | Personal, non-public use. No running it as an event. |
| `event` | One named CTF event, unlimited players, for its duration. |
| `unlimited` | Any number of events by the purchasing organization. |

The license text is **snapshotted onto the order** at purchase. Changing a listing's license
terms later must never retroactively change what somebody already bought.

Every delivered bundle carries a `LICENSE.txt` naming the buyer, the order, and the grant.

## What this does not do

No cart, no subscriptions, no automated disputes beyond a refund action, no multi-currency.
IDR only in v1, because Midtrans settles in IDR and a display-only currency conversion invites
a rounding bug in exchange for nothing.

See also: [[domain-model]], [[security-guardrails]], [[decisions/0005-webhook-driven-orders]].
