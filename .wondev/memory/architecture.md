---
title: Architecture
always: true
description: How this system is put together and where things belong — the three planes, the pipeline, and the boundaries that must not be crossed
verified: 2026-09-02
verifiedAgainst: the src/ tree as built, and an end-to-end run through real Docker — submit, verify, publish, buy, fulfil, download, solve the delivered bundle
---

# Architecture

## What this project is

**Aya's Playground** is a marketplace for buying and selling CTF challenges. Authors list a
challenge; buyers purchase it and receive a ready-to-deploy bundle for their own event or
practice. **v1 sells Cryptography challenges only** — the taxonomy is data, so other
categories are configuration rather than code, but nothing else is enabled yet.

It is deliberately **not** a CTF hosting platform. It does not run events, does not host live
challenge instances, and does not keep a scoreboard. It sells the artifact; the buyer runs it
on their own CTFd (or anything else). See [[decisions/0002-three-plane-architecture]].

## Shape of the system — three planes

| Plane | Responsibility | Talks to |
| ----- | -------------- | -------- |
| **Catalog** | Challenges, immutable versions, listings, crypto-scheme taxonomy, search, purchase-gated reviews | Store, Forge (for verification state) |
| **Forge** | The sandbox. Builds a challenge for a given flag, verifies it is solvable, fulfills an order | Docker, Queue, Store |
| **Commerce** | Orders, Midtrans payments, escrow, licenses, signed delivery, payout balances | Midtrans, Forge (fulfillment), Store |

The pipeline runs left to right, and every stage is persisted:

```
submit → build → verify → publish → order → fulfill → deliver
         └──────┬──────┘                     └──┬──┘
             Forge sandbox                 same Forge sandbox
```

`build`, `verify`, and `fulfill` are three callers of **one** sandbox primitive. Fulfillment
re-runs the seller's generator with the buyer's flag, which is why the sandbox sits on the
order critical path and why fulfillment is a queued job with retry rather than a synchronous
request. See [[decisions/0003-flag-modes]].

## Where code goes

```
src/app/           Next.js App Router — pages and route handlers.
                   Route handlers validate input, call a plane, and shape a response.
                   They hold NO business logic.
src/components/    React components, PascalCase files.
src/lib/core/      Shared contracts: bundle schema, flag derivation, license types,
                   error taxonomy, id generation. Imported by every plane; imports none.
src/lib/catalog/   Challenges, versions, listings, taxonomy, reviews, search.
src/lib/forge/     Runner contract, docker runner, stub runner, build/verify/fulfill, queue.
src/lib/commerce/  Orders, order state machine, Midtrans client + webhook, escrow,
                   licenses, delivery tokens, payout balances.
src/lib/auth/      Sessions, users, route guards.
src/lib/store/     Persistence behind one interface: memory (default) + Postgres.
src/lib/audit/     Append-only audit log.
deploy/runner/     Sandbox images — python-crypto, sage.
test/              Integration and contract tests; unit tests sit beside their source.
```

Dependency direction is one-way: `core` ← planes ← `app`. A plane never imports another
plane's internals — only its public entry module and `core`.

## Boundaries that matter

1. **Seller-supplied code executes only inside the Forge sandbox.** No code path in the
   Next.js process ever evaluates, imports, or spawns bundle content. This is the rule whose
   violation is remote code execution on the host. See [[security-guardrails]].
2. **A listing publishes only against a passing verification bound to its exact version
   hash.** Change the bundle, and the hash changes, the verification is invalidated, and the
   listing auto-unpublishes. A "Verified" badge that can drift from what it verified is worse
   than no badge.
3. **Flags are derived, never stored in plaintext.** `flag = KDF(server_secret, order)`.
   There is no flag column to leak.
4. **Order state changes only through the state machine**, driven by signature-verified
   Midtrans webhooks. A client redirect never moves money. See [[commerce]].
5. **The UI never reaches the store directly.** It goes through a plane, which is where
   authorization lives.

## What is intentionally simple

- **The store defaults to in-memory.** `npm run dev` boots with no Postgres and no Docker.
  This is what keeps the project runnable, and it is not a bug to fix. Set `DATABASE_URL`
  and the identical interface is served by Postgres instead — `test/store-contract.test.ts`
  runs one suite against both, so what the tests prove about development is also true of
  production.

  Two things only the database can give, and they are why it exists: `compareAndSet`
  becomes `UPDATE ... WHERE id = $1 AND state = $2`, atomic across processes, so a
  duplicated webhook handled by two workers cannot double-transition an order; and the
  download counter and payout arithmetic become single statements rather than
  read-modify-write.
- **Payouts are a recorded balance an admin releases by hand.** Automated disbursement means
  KYC onboarding, and v1 does not have the volume to justify it.
- **Search is a SQL/array filter, not a search engine.** A crypto-only catalog is small.
  Adding Elasticsearch before there is anything to search is the wrong trade.

## Process-wide state

The store, the sandbox runner, and the job queue are **`globalThis`-backed singletons**
(`src/lib/core/singleton.ts`), not module-level `let`s.

This is not a style preference. Next.js compiles route handlers into separate module
registries, so with a plain module-level variable, `/api/auth/register` and `/api/auth/login`
each get their **own** in-memory store — registering a user and then failing to find them.
That bug is silent, and it looks like a password problem.

One consequence to know in development: a `globalThis` instance survives hot reload, so a code
change to the runner or the store does not take effect until the dev server restarts.

See also: [[conventions]], [[security-guardrails]], [[domain-model]], [[glossary]].
