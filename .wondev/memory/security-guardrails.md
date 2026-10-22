---
title: Security guardrails
always: true
description: Non-negotiable rules for executing seller code and handling money — sandbox isolation, flag secrecy, payment integrity
---

# Security guardrails

This marketplace runs **arbitrary code written by strangers** and **moves real money**. These
are hard requirements, not configuration.

## The sandbox

Every execution of seller-supplied code — build, verify, or fulfill — runs in a container
with all of the following. There is no "just this once" path.

| Control | Setting | Why |
| ------- | ------- | --- |
| Network | `--network=none` | A crypto challenge never needs network. This removes exfiltration and pivoting outright. |
| Root filesystem | `--read-only` | Nothing persists outside the declared output mount. |
| Writable space | `--tmpfs /tmp` with a size cap | Bounded scratch; a fork-bomb of files cannot fill the host disk. |
| User | `--user 65534:65534` | Never root, even inside the container. |
| Capabilities | `--cap-drop=ALL` | No `CAP_NET_RAW`, no `CAP_SYS_PTRACE`. |
| Privilege escalation | `--security-opt=no-new-privileges` | Defeats setuid tricks. |
| Memory | `--memory` cap | An OOM inside the container is a failed run, not a dead host. |
| CPU | `--cpus=1` | One tenant cannot starve the queue. |
| Processes | `--pids-limit` | Fork-bomb containment. |
| Wall clock | host-side timeout, then `docker kill` | A `while True` is a failed run. Do not rely on the container to stop itself. |
| Output | captured, byte-capped, truncated | Unbounded stdout is a memory exhaustion vector on the host. |

Input is mounted **read-only**; exactly one writable output directory is mounted. No host
path outside the run directory is ever mounted, and the run directory is created per-run
under a dedicated root and deleted afterwards.

**Archive extraction is a security boundary of its own.** An uploaded bundle is a
zip/tar from a stranger. Reject path traversal (`../`), absolute paths, symlinks pointing
outside the tree, and enforce a total-uncompressed-size and file-count cap before writing a
single byte — a zip bomb must be refused during inspection, not discovered during extraction.

## The stub runner

`stubRunner` exists so `npm run dev` works without Docker. It validates structure and returns
a verdict of `unverified`. **It can never return `passed`.** If a code path lets it, the
"Verified solvable" badge — the entire trust proposition of this marketplace — becomes a
claim nobody checked.

## Flags

- Derived, never stored: `flag = KDF(AYA_FLAG_SECRET, challengeVersionId + orderId)`.
- `AYA_FLAG_SECRET` is required in production and fails closed when unset.
- **Never logged.** Not in the audit trail, not in an error, not in a persisted sandbox
  capture. Sandbox output is scrubbed for the run's flag before it is stored or shown.
- Verification uses an ephemeral random flag, never a buyer's derived flag.
- Seller-facing and admin-facing views never show a buyer's flag.

## Money

- Order state advances **only** on a Midtrans webhook whose signature verifies as
  `sha512(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)`. A client returning
  from the payment page proves nothing.
- Webhooks retry, arrive out of order, and duplicate. Every transition is **idempotent**, and
  a transition that is not legal from the current state is refused and audited rather than
  applied.
- The authoritative amount is the one the server computed at order creation, never a value
  read back from the request body.
- Funds are held through the dispute window before a seller balance becomes payable.

## Audit log

Append-only. Who / what / when for every: bundle submission, sandbox run, verification
verdict, publish/unpublish, order transition, delivery, refund, and payout. The *who* is the
authenticated actor, attached at the route boundary. Never contains a flag or a solver body.

## Access control

- **Fail closed on a missing payment key.** `getMidtransClient` throws in production when
  `MIDTRANS_SERVER_KEY` is unset rather than falling back to the offline client. That fallback
  plus `/api/payments/offline` would be a free checkout — a buyer marking their own order paid.
  The offline route independently refuses to run in production, because the failure mode is bad
  enough to deserve two locks.
- **Login is rate limited** per source address *and* per account
  (`src/lib/auth/rate-limit.ts`). `X-Forwarded-For` is spoofable, which is why the per-account
  bucket exists. scrypt is expensive by design, so this bounds a CPU exhaustion vector as well
  as guessing.
- **Mutating `/api/*` requires same-origin when `Origin` is present** (`src/middleware.ts`),
  on top of `SameSite=strict` session cookies. The Midtrans webhook is exempt: it is
  server-to-server and its authenticity comes from the signature, which is stronger.
- **Roles are re-read from the store on every guarded request**, not trusted from the session
  token, so revoking a role takes effect immediately rather than at token expiry.

## Content risk

Seller-authored text — a listing summary, a `challenge.yml` description, a review body — is
rendered as JSX text, so React escapes it. There is no `dangerouslySetInnerHTML` anywhere in
this repository, and adding one to render a writeup as markdown would introduce stored XSS in
a buyer's authenticated session. If markdown rendering is ever wanted, it must have HTML
disabled at the parser, not sanitized afterwards.

Sandbox output (`Verification.log`) is shown to sellers inside a `<pre>`. It is
flag-scrubbed before storage and escaped on render.

See also: [[architecture]], [[commerce]], [[decisions/0004-sandbox-isolation]].
