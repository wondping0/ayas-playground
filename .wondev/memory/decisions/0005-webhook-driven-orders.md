---
title: 0005 — Webhook-driven order state, Midtrans, IDR minor units
always: false
description: Why payment state comes only from signed webhooks, why every transition is idempotent, and why money is an integer
---

# 0005 — Webhook-driven order state, Midtrans, IDR minor units

**Status:** accepted · **Date:** 2026-09-02

## Context

Buyers and sellers are Indonesian, so the payment rails that matter are QRIS, GoPay, virtual
account, and bank transfer. Stripe has no Indonesian entity; Midtrans Snap covers all four.

Every one of those rails is **asynchronous**. A bank transfer settles minutes or hours after
the buyer leaves the checkout page. There is no moment where the browser knows the truth.

## Decision

Order state advances **only** on a Midtrans webhook whose signature verifies as
`sha512(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)`. The browser returning
from checkout triggers a poll of server state, never a transition.

All transitions are **idempotent** and validated against the table in [[commerce]]. Webhooks
duplicate, retry, and arrive out of order; re-applying a transition already applied returns
200 and does nothing, and an illegal transition is refused and audited rather than applied.

Amounts are **integer IDR minor units** in a branded type, and the authoritative amount is the
one the server computed at order creation. A `gross_amount` from a webhook body is input to
signature verification and nothing else.

## Consequences

- A working local dev loop needs a way to simulate webhooks; a signed-payload test helper is
  part of the commerce plane, not an afterthought.
- Order TTL and the `expire` webhook both have to be handled — the webhook can be missed.
- Refunds are recorded as state transitions with an audit entry, even when the actual money
  movement is performed by hand in the Midtrans dashboard in v1.

## Rejected: trusting the redirect, "just for the happy path"

Treating a `?status=success` redirect as payment is the classic marketplace vulnerability: the
buyer controls the URL. It is tempting because it makes local development easy. The signed-
webhook test helper exists specifically to remove that temptation.

## Rejected: floats, and multi-currency display

`number` for money invites a rounding error that only shows up in reconciliation. IDR has no
subunit in practice but the branded integer type is kept anyway, so adding a currency later is
a type change rather than an audit of every arithmetic site. Display-only currency conversion
was rejected outright: it adds rounding and staleness bugs and buys nothing while settlement
is IDR.
