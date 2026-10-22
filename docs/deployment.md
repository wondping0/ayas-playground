# Deployment

Aya has two surfaces. The public landing is static; the marketplace needs a
Node.js server, persistence, and a Docker-capable host for Forge.

| Surface | Source | Destination |
| --- | --- | --- |
| Application and editable landing | `wondping0/ayas-playground` | This repository |
| Public marketing page | Reviewed `landing/` files | `wondping0/wondping0.github.io/ayas-playground/` |
| Marketplace server | Next.js production build | Your server; not GitHub Pages |

Publishing source does not provision an application host or payment service.
The current public URL serves [the landing page](https://wondping0.github.io/ayas-playground/).

## GitHub Pages

Follow [the publication guide](../landing/PUBLISHING.md), which lists the four
permitted browser files. Keep Pages on the existing user-site repository rather
than creating a second site at the same URL. Do not publish `.next/`, server code,
or environment files.

## Marketplace server

This is a deployment procedure, not production certification. CI exercises the
stub and contract tests; it does not process real payments or certify the target
host's sandbox isolation.

The dependency audit on 2026-10-22 reported 21 advisories (4 critical, 12 high,
5 moderate), including Next.js and development tooling. Suggested resolutions
include major-version upgrades. Dependency remediation and regression testing
are outstanding before an internet-facing marketplace deployment. Passing CI
does not clear these advisories.

Use a dedicated host with Node.js 22, Docker, Postgres, persistent artifact storage,
and an HTTPS reverse proxy. Run Node on that host so Forge bind mounts refer to
the same filesystem seen by Docker. A serverless host without Docker access
cannot execute the real Forge workflow.

### Environment

Use `.env.example` as a reference. Supply secrets through the host environment or
a private file outside version control.

| Variable | Purpose |
| --- | --- |
| `AYA_ENV=production` | Application fail-closed production checks |
| `NODE_ENV=production` | Next.js production runtime |
| `AYA_AUTH_SECRET` | Independent high-entropy session/delivery secret |
| `AYA_FLAG_SECRET` | Independent high-entropy flag derivation secret |
| `DATABASE_URL` | Durable Postgres connection |
| `AYA_DATA_DIR` | Absolute path to persistent bundle/artifact storage |
| `AYA_RUNNER=docker` | Real isolated verification and fulfillment |
| `MIDTRANS_SERVER_KEY` | Midtrans server credential |
| `MIDTRANS_CLIENT_KEY` | Corresponding client credential |
| `MIDTRANS_IS_PRODUCTION` | `false` for staging sandbox, `true` for live credentials |

Set `AYA_ENV` explicitly: `NODE_ENV` alone does not enable the application's
production checks. Preserve the flag secret across deployments; rotating it
changes derived order flags.

### Build and migrate

Run `npm run verify` in CI or a separate development environment before deployment,
without deployment credentials or a deployment `DATABASE_URL`. The store contract
suite truncates tables when a test database is configured; never run it against
the marketplace database. On the deployment host, build and migrate only:

```sh
npm ci
npm run build
npm run runner:build
npm run db:migrate
```

Export `DATABASE_URL` in the shell for migration; the migration script does not
load `.env.local`. Use `npm run runner:build -- --sage` for Sage challenges.

### Start standalone output

Next.js emits a standalone server but does not copy static assets into it.
From the repository root on a POSIX host:

```sh
cp -R .next/static .next/standalone/.next/static
# If public/ is added, copy it into .next/standalone/public too.
HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js
```

Use a process supervisor and an HTTPS reverse proxy. Keep `AYA_DATA_DIR` absolute
so changing the working directory does not change the storage location. Keep the
checkout for migrations and image-build scripts, which are not in the server output.

### Verify your environment

1. Check homepage, authentication, and role guards through the HTTPS origin.
2. Submit a controlled example and observe real Docker verification. The stub
   must remain `unverified`.
3. Exercise Midtrans sandbox checkout and fulfillment before live payments.
   Set its notification URL to `https://YOUR_ORIGIN/api/payments/midtrans`.
4. Verify downloads require the correct buyer and a valid delivery token.
5. Check persistence across restarts and test backup restoration.

Do not seed a real marketplace: the seed creates known demo accounts. Payouts
require manual administration. The queue is process-local; this procedure does
not establish multi-instance worker orchestration. Review recovery and capacity
for your workload before accepting real orders.

## Updates and rollback

Deploy an immutable commit, retain the previous application build, and back up
the database and artifacts. Review schema compatibility before rollback. A code
rollback does not undo a payment or restore a deleted artifact.
