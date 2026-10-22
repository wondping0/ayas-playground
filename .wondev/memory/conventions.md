---
title: Conventions
always: true
description: How code in this repository is written, named, tested, and reviewed
verified: 2026-09-02
verifiedAgainst: package.json scripts, and `npm run verify` passing — typecheck, lint, 442 tests, next build
---

# Conventions

## Language and tooling

TypeScript, a single Next.js 14 App Router app on **npm**, code under `src/`. Frontend is
Tailwind + shadcn/ui. Persistence is Postgres via `pg`, behind a store interface whose
default implementation is in-memory.

```
install:      npm install
dev:          npm run dev
build:        npm run build          # next build
test:         npm test               # vitest run
lint:         npm run lint           # next lint
typecheck:    npm run typecheck      # tsc --noEmit
verify:       npm run verify         # typecheck + lint + test + build
runner:build: npm run runner:build   # sandbox images (needs Docker)
seed:         npm run seed           # example challenges into a running server
db:migrate:   npm run db:migrate     # apply schema.sql to DATABASE_URL
```

The Postgres half of the store contract suite is **skipped** unless `DATABASE_URL` is set.
Run it before touching `postgres.ts`, against a **separate database** — the suite truncates
every table before each test:

```
docker compose up -d
docker compose exec db createdb -U aya aya_test
DATABASE_URL=postgres://aya:aya@localhost:5433/aya_test npm run db:migrate
DATABASE_URL=postgres://aya:aya@localhost:5433/aya_test npm test -- store-contract
```

`PostgresStore.reset()` refuses a database whose name does not contain "test". That guard is
the only thing between the test suite and development data, so do not name a working
database `..._test`.

## Naming

- Files: kebab-case — `order-state-machine.ts`, `docker-runner.ts`.
- React components: PascalCase files under `src/components/` — `ListingCard.tsx`.
- Types and interfaces: PascalCase, no `I` prefix — `SandboxRunner`, not `ISandboxRunner`.
- Tests sit beside their source as `<name>.test.ts`; cross-plane tests live in `test/`.

## Testing

vitest. TDD where practical: write the failing test first for anything in `core/` or any
state transition.

**Two things require exhaustive tests, not representative ones:**

1. **The order state machine** — every transition in the table, and every transition *not* in
   the table asserted to be rejected. Money moves here.
2. **The sandbox argument builder** — assert every isolation flag is present in the generated
   `docker run` argv. That test is a security control that happens to be written in vitest;
   treat a change to it with the seriousness of changing a firewall rule.

Everything in `src/lib/core/` has tests. Anything parsing untrusted input — `challenge.yml`,
webhook bodies, uploaded archives — needs a malformed-input case, not only a happy path.

A change to either store implementation goes in `test/store-contract.test.ts`, which runs
one suite against both. A test written against only the in-memory store proves nothing about
what production does.

## Error handling

Expected, handled conditions — a rejected bundle, a failed verification, a declined payment,
an expired download token — return a structured error from the taxonomy in `src/lib/core/`
and are written to the audit log. Programming bugs crash loudly; do not wrap a plane in a
catch-all that turns a bug into a 200.

Never return a raw sandbox stderr to a buyer. It is seller code output and may contain the
flag or the solution.

## Comments

Comment the *why*, never restate the *what*. The highest-value comments in this codebase
explain a security decision — why an isolation flag is set, why a check happens before rather
than after a normalization step.

## What not to do

- **Never execute bundle content outside the Forge sandbox** — no `require`, no `eval`, no
  `child_process` on seller files. See [[security-guardrails]].
- **Never let the stub runner emit a `passed` verdict.** It exists so the app boots without
  Docker; if it can pass a verification, the badge is a lie.
- **Never trust a Midtrans client redirect** to move an order forward. Webhook only, signature
  verified. See [[commerce]].
- **Never store a flag in plaintext**, and never log one — not in the audit log, not in an
  error, not in a sandbox output capture that gets persisted.
- **Never put business logic in a route handler.** If a handler is longer than input
  validation plus one plane call plus a response, the logic belongs in a plane.
- **Never commit secrets.** `AYA_FLAG_SECRET`, `MIDTRANS_SERVER_KEY`, and `AYA_AUTH_SECRET`
  come from env and fail closed when unset in production.
- **Never import `src/lib/core/flag.ts` from a client component.** It reaches for
  `node:crypto` and would put flag derivation in the browser bundle. Pure format helpers live
  in `flag-format.ts`, which a client component may import; the split is a boundary, not a
  convenience.
- **Never hold process-wide state in a module-level `let`.** Use
  `src/lib/core/singleton.ts` — see the note in [[architecture]] for the bug this prevents.

See also: [[architecture]], [[security-guardrails]].
