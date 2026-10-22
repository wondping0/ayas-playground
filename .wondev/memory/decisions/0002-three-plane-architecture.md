---
title: 0002 — Catalog / Forge / Commerce planes
always: false
description: Why the marketplace splits into three planes and why sandboxed execution is its own plane rather than a utility
---

# 0002 — Catalog / Forge / Commerce planes

**Status:** accepted · **Date:** 2026-09-02

## Context

A challenge marketplace has three concerns that fail differently: describing and finding
things, executing untrusted code, and moving money. Bundling them produces a codebase where a
sandbox bug is reachable from a search endpoint.

## Options

**A — Conventional layering** (controllers / services / repositories). Familiar, but it puts
the sandbox on the same footing as a string formatter. Nothing in the structure signals that
one service runs code written by strangers.

**B — Three planes: Catalog, Forge, Commerce.** Execution gets a named boundary with its own
entry points, so "does this path reach the Forge?" is answerable by reading imports.

**C — Separate services from day one.** Real isolation, at the cost of deployment and
transactional complexity before there is a single user.

## Decision

**B.** The Forge is a plane because *what makes it dangerous is not its size, it is its
kind*. Naming the boundary is what makes the rule in [[security-guardrails]] —
"seller code executes only inside the Forge sandbox" — mechanically checkable rather than a
convention people remember.

The Forge is also the natural seam for C later: it already has a queue and a
request/response contract, so moving it to a separate worker is a deployment change, not a
rewrite.

## Consequences

- `src/lib/forge/` is the only place `child_process` or Docker is touched. A `child_process`
  import anywhere else is a review-blocking finding.
- Build, verify, and fulfill share one primitive, so isolation is implemented once.
- Cross-plane calls go through public entry modules, which costs some indirection in exchange
  for a dependency graph that can be audited.
