---
title: Domain model
always: false
description: The entities of the marketplace and how they relate — read before adding a table, a field, or anything touching challenges, listings, or orders
---

# Domain model

The distinction that carries the most weight: **a Challenge is authored, a
ChallengeVersion is immutable, and a Listing is commercial.** Verification binds to a
version, pricing binds to a listing, and delivery binds to an order. Collapsing any two of
these breaks a rule in [[architecture]].

## Entities

| Entity | Holds | Notes |
| ------ | ----- | ----- |
| `User` | identity, `roles: (buyer \| seller \| admin)[]` | One account can buy and sell. |
| `Challenge` | seller, title, slug, category, current version | The authored thing, mutable metadata. |
| `ChallengeVersion` | `bundleHash`, manifest, flag mode, storage key | **Immutable.** A new upload is a new version, never an edit. |
| `Verification` | version, runner kind, verdict, duration, log ref | Verdict: `passed \| failed \| unverified \| error`. |
| `Listing` | version, price (IDR), license type, state | State: `draft \| pending \| published \| rejected \| delisted`. |
| `Order` | buyer, listing, amount, state, Midtrans ref, flag format | Amount is frozen at creation. See [[commerce]]. |
| `License` | order, type, terms snapshot | What the buyer may do, captured at purchase time. |
| `Delivery` | order, artifact key, download count, expiry | The materialized per-buyer bundle. |
| `Review` | order, rating, body | Purchase-gated; one per order. |
| `PayoutBalance` | seller, pending / payable / paid | Moves to payable after the dispute window. |
| `AuditEntry` | actor, action, subject, timestamp | Append-only. |

## Relationships

```
User(seller) 1─* Challenge 1─* ChallengeVersion 1─* Verification
                                      │
                                      1
                                      *
                                   Listing 1─* Order 1─1 License
                                                   │
                                                   1─1 Delivery
                                                   1─0..1 Review
```

## Rules that live in code, not in the reader's head

- A `Listing` may enter `published` **only** when its `ChallengeVersion` has a `Verification`
  with verdict `passed` whose `bundleHash` equals the version's current hash.
- Uploading a new bundle creates a new `ChallengeVersion`. Existing `Order`s keep pointing at
  the version they bought — a buyer's purchase never changes under them.
- A `Review` requires an `Order` in state `delivered` belonging to the reviewer.
- `PayoutBalance` moves `pending → payable` only after the order's dispute window closes with
  no refund.
- Prices are **integer IDR minor units**. Never a float. Never a currency-less number.

## Deliberate omissions in v1

No carts (one listing per order), no bundles/collections, no subscriptions, no seller
storefronts beyond a profile, no messaging between buyer and seller. Each is a seam, not a
plan.

See also: [[architecture]], [[bundle-contract]], [[commerce]].
