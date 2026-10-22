# Aya's Playground

![Aya's Playground — a playground for curious minds](docs/assets/readme-banner.svg)

[![CI](https://github.com/wondping0/ayas-playground/actions/workflows/ci.yml/badge.svg)](https://github.com/wondping0/ayas-playground/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-39753b.svg)](LICENSE)
[![Node.js 22](https://img.shields.io/badge/Node.js-22-39753b.svg)](.nvmrc)

**Serious crypto. A little play.**

A marketplace for buying and selling cryptography CTF challenges. Authors package a puzzle; buyers receive a licensed bundle to run at their own event or practice session.

[Landing page](https://wondping0.github.io/ayas-playground/) · [Quick start](#quick-start) · [Architecture](#architecture) · [Deployment](docs/deployment.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

**Status:** active development. The public website is a product introduction,
not a hosted marketplace. Published source and passing CI do not imply production
payment or sandbox certification.

**Dependency status (2026-10-22):** `npm audit` reports 21 advisories, including
4 critical, in the current dependency tree. These are dependency advisories,
not an application exploit assessment. Resolve them and validate the upgrades
before deploying an internet-facing marketplace. See [deployment](docs/deployment.md).

## Why it exists

A challenge is difficult to evaluate without spoiling it. Aya's Playground keeps the solution sealed and exposes a verification receipt instead: the author's solver must recover the test flag inside the Forge sandbox before that exact bundle version can be published. Re-flaggable bundles use an ephemeral flag; static bundles use the author's fixed flag.

At fulfillment, re-flaggable bundles receive an order-specific flag. Static bundles retain the same fixed flag for every buyer. Buyers get the handout, solver, and writeup; authors can give an existing challenge a new audience.

**This is an artifact marketplace.** It does not host events, run live challenge instances, or maintain scoreboards. v1 supports cryptography only.

## Quick start

Use **Node.js 22 and npm** (see `.nvmrc`; the package minimum is Node 20).
Docker and Postgres are optional for browsing and UI development.

```bash
git clone https://github.com/wondping0/ayas-playground.git
cd ayas-playground
npm ci
cp .env.example .env.local
npm run dev
```

On PowerShell, replace `cp` with `Copy-Item .env.example .env.local`. Open **http://localhost:3000**.

Generate two independent secrets, running this command once for each:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the values in `AYA_FLAG_SECRET` and `AYA_AUTH_SECRET` in `.env.local`. Keep this file private.

By default, the store is in memory and the sandbox is a stub. Data disappears when the server restarts. The catalog starts empty: the stub returns `unverified` and **cannot publish a challenge**. This is expected.

### Run the complete challenge workflow

1. Start Docker and build the sandbox images with `npm run runner:build`.
2. Set `AYA_RUNNER=docker` in `.env.local` and restart the dev server.
3. In a second terminal, run `npm run seed`.

The seed drives the real HTTP API to register accounts, upload the examples, verify them, and publish listings. Use it only against a local development server. The Python image handles the included examples; use `npm run runner:build -- --sage` when you need Sage.

| Demo account | Email | Password |
| --- | --- | --- |
| Buyer | `buya@aya.test` | `correct-horse-battery-staple` |
| Seller | `sella@aya.test` | `correct-horse-battery-staple` |
| Admin | `admin@aya.test` | `correct-horse-battery-staple` |

### Persist data with Postgres

```bash
docker compose up -d
```

Set `DATABASE_URL=postgres://aya:aya@localhost:5433/aya` in the shell before running `npm run db:migrate`. The standalone migration script does not load Next.js `.env.local`. Set the same URL in `.env.local` for the app, then restart it.

PowerShell example:

```powershell
$env:DATABASE_URL = 'postgres://aya:aya@localhost:5433/aya'
npm run db:migrate
npm run dev
```

## Architecture

```text
submit → build → verify → publish → order → fulfill → deliver
         └── Forge sandbox ──┘              └─ Forge ─┘
```

| Area | Responsibility |
| --- | --- |
| `src/lib/catalog/` | Challenges, immutable versions, listings, taxonomy, search, reviews |
| `src/lib/forge/` | Isolated execution, build, verification, queued fulfillment |
| `src/lib/commerce/` | Orders, Midtrans webhooks, escrow, licences, delivery, payouts |
| `src/lib/core/` | Shared contracts, flag derivation, errors; imports no plane |
| `src/app/` | Next.js pages and thin route handlers |
| `src/lib/store/` | A common interface for in-memory and Postgres persistence |
| `landing/` | Independent static marketing page for GitHub Pages |

Dependencies point from app to planes to core. UI components never read the store directly. Process-wide services use `globalThis` singletons because Next.js route handlers can have separate module registries. Restart development after changing a store or runner implementation.

## What's in a bundle?

The format extends CTFd's `ctfcli` `challenge.yml` with an `aya:` block.

```text
challenge.yml
release_files/        Player handout
server_files/
  generate.py         Generator for generate-mode challenges
solver/
  solve.py            Prints the recovered flag
writeup.md            Author's explanation
```

Flag modes are `static`, `substitute`, and `generate`. Crypto ciphertext usually needs `generate`: the flag is encrypted into the output, so fulfillment reruns the generator rather than replacing text. See the [complete bundle contract](.wondev/memory/bundle-contract.md) and working [examples](examples/).

## Security and trust

- Seller code runs only in the isolated Forge container: no network, non-root user, read-only root, capped resources, dropped capabilities, and a host timeout.
- Verification is bound to the exact version hash. The stub cannot pass verification.
- Flags are derived and scrubbed from persisted output. Production secrets must be configured.
- Payment state comes from signature-verified Midtrans webhooks, never the browser redirect. Offline checkout is development-only.
- Archive inspection rejects unsafe paths and oversized bundles before extraction.

Verification demonstrates that the supplied solver recovered the flag in that run; it does not prove the absence of alternative solutions. Per-order flags offer traceability, not copy protection.

## Development and checks

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Next.js development server |
| `npm run build` / `npm start` | Build / serve the production app |
| `npm test` | Run Vitest |
| `npm run typecheck` | Check TypeScript |
| `npm run lint` | Run Next.js lint |
| `npm run verify` | Typecheck, lint, tests, and build |
| `npm run runner:build` | Build Docker sandbox images |
| `npm run seed` | Seed examples through a running server's API |
| `npm run db:migrate` | Apply the Postgres schema |

The Postgres contract suite is skipped unless `DATABASE_URL` is set. It truncates tables: use a dedicated database whose name contains `test`, never your working database. See [conventions](.wondev/memory/conventions.md) for setup.

GitHub Actions runs `npm run verify` and a separate Postgres contract job against
a disposable `aya_test` database. See the [CI workflow](.github/workflows/ci.yml).

## Landing page and deployment

The public landing page is **https://wondping0.github.io/ayas-playground/**. Its **Aya's Number Challenge** theme uses a light canvas, leaf-green accents, playful number tiles, and an editorial puzzle collection. This is the visual identity of the landing page; the application remains Aya's Playground, a cryptography challenge marketplace.

`landing/index.html`, `landing/styles.css`, `landing/app.js`, and `landing/assets/aya.svg` form a buildless public landing page. A short number-sequence warm-up gives immediate feedback and explains the answer without making API calls. With JavaScript disabled, the sequence and its native explanation disclosure remain readable. System fonts avoid font downloads. The page contains no checkout, authentication, analytics, external font services, or backend secrets. Preview locally:

```bash
python -m http.server 4173 --bind 127.0.0.1 --directory landing
```

Open http://localhost:4173. Run `npm test -- landing` to check correct and incorrect answers, retry behavior, the no-JavaScript fallback, section links, and local HTML assets.

Publication follows q-agent's existing setup: copy the allowlisted browser files into `ayas-playground/` in the public **`wondping0/wondping0.github.io`** repository. Its existing GitHub Pages configuration publishes `main` from `/`; the personal site and `q-agent/` stay in place. The application source and local environment files are not part of the public upload. See [publishing instructions](landing/PUBLISHING.md) for the exact boundary and deployment record.

The marketplace itself needs a Node.js server and, for real verification and fulfillment, access to the hardened Docker runner. GitHub Pages only hosts the static landing page. Configure production secrets, Postgres, Midtrans, and durable artifact storage before operating the marketplace with real purchases.

See the [deployment guide](docs/deployment.md) for standalone output, environment
configuration, persistence, and validation on your host.

## Project documentation

Start with the [memory index](docs/memory-index.md), then read only the relevant documents. Source guidance lives in `.wondev/`; [wondev](https://github.com/wondping0/wondev) generates `AGENTS.md`, `CLAUDE.md`, and `GUIDE.html`.

- [Architecture](.wondev/memory/architecture.md)
- [Security guardrails](.wondev/memory/security-guardrails.md)
- [Commerce](.wondev/memory/commerce.md)
- [Architecture decisions](.wondev/memory/decisions/)

v1 intentionally keeps payouts manual, search simple, and the catalog crypto-only.

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
For questions or bugs, see [SUPPORT.md](SUPPORT.md). Participation follows
the [Code of Conduct](CODE_OF_CONDUCT.md).

Report suspected vulnerabilities privately to **wondev.support@gmail.com**;
avoid posting sensitive reproduction details in public issues.

## License

The software and repository-owned examples are available under the
[MIT license](LICENSE), copyright 2026 wondping0. Third-party dependencies retain
their own licences. Challenge bundles sold by marketplace authors use their own
commercial licence terms; purchasing a bundle does not make it MIT-licensed.
