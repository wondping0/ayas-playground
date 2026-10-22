---
title: 0004 — Docker sandbox with a stub that cannot pass
always: false
description: Why seller code runs in a hardened container, and why the no-Docker fallback is forbidden from producing a passing verdict
---

# 0004 — Docker sandbox with a stub that cannot pass

**Status:** accepted · **Date:** 2026-09-02

## Context

The "Verified solvable" badge is the marketplace's entire answer to "how do I know this
challenge is any good when I can't look at it?". Producing it means running a stranger's
Python. Not producing it means competing with a generic digital-goods store on price alone.

## Options

**A — Manual admin review.** No execution risk, no scale, and the badge is an opinion.

**B — In-process execution with a timeout.** Cheap and catastrophic: a solver is arbitrary
code with the app's filesystem, network, and environment — including `MIDTRANS_SERVER_KEY`.

**C — Hardened container per run.** Real isolation. Requires Docker on the host.

**D — A third-party sandbox service.** Removes the ops burden, adds a vendor on the critical
path of publishing and fulfillment.

## Decision

**C**, with the full control set in [[security-guardrails]]: no network, read-only root,
non-root user, all capabilities dropped, no-new-privileges, memory/CPU/PID caps, host-side
wall-clock kill, byte-capped output, one writable mount.

A `stubRunner` exists so the app boots and develops without Docker — and **it is structurally
forbidden from returning `passed`.** It returns `unverified`.

## Consequences

- `npm run dev` works with no Docker; nothing can be *published* in that mode, which is
  correct rather than inconvenient.
- The argv builder for `docker run` has an exhaustive test asserting every isolation flag.
  That test is a security control; changing it is changing a firewall rule.
- Archive extraction is treated as a separate boundary with its own traversal, symlink, and
  zip-bomb checks, because a malicious bundle attacks during *inspection*, before any sandbox
  is involved.
- Sage support means a second, much larger image; it is opt-in per challenge.

## Rejected: trusting `--network=none` alone

Network isolation prevents exfiltration but not local resource exhaustion. The memory, PID,
and wall-clock caps are not redundant with it — they are the controls that keep one hostile
submission from taking down the queue for everyone.
