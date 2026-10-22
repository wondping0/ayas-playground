---
title: 0003 — Per-buyer flags, and why `generate` mode exists
always: false
description: Why every sale re-flags the challenge, why crypto forces re-running the generator, and what that costs
---

# 0003 — Per-buyer flags, and why `generate` mode exists

**Status:** accepted · **Date:** 2026-09-02

## Context

A CTF challenge is worth something only while its flag is unknown. Sell the same bundle to
fifty buyers and one leak destroys it for all fifty — including for the seller, who can no
longer list it. A marketplace that ignores this sells an asset it is simultaneously
destroying.

Prior art converges on assigning a flag when a handout is downloaded rather than baking it in:
GPN CTF 2025's flag-sharing post-mortem, and ctfer.io's chall-manager, both do this per team.
A marketplace is the same problem with "team" replaced by "order".

## Options

**A — One flag per challenge.** Trivial. Destroys the asset on first leak.

**B — Token substitution.** Replace `{{FLAG}}` in release files at delivery. Cheap, and
**wrong for most crypto**: the flag is not present in an RSA ciphertext as text, it is
encrypted into it. Substitution silently produces a challenge whose output no longer
corresponds to its flag.

**C — Re-run the author's generator with the buyer's flag.** Correct for crypto, at the cost
of executing seller code on the order fulfillment path.

## Decision

Support all three as declared **flag modes**, with `generate` (option C) as the intended
default for crypto. `static` exists for legacy imports and is marked as lower value in the UI,
because a challenge that cannot be re-flagged genuinely is worth less.

## Consequences

- **The sandbox is on the money path.** Fulfillment can fail after payment succeeds, so the
  order state machine has an explicit `fulfill_failed` state with an operator action attached
  ([[commerce]]). This is the main cost of the decision and it was accepted deliberately.
- Fulfillment is a queued job with retry, never a synchronous request.
- Every delivered bundle is unique, so a leaked flag identifies the order it came from.
- Sellers must write a generator that is deterministic given `$FLAG` and writes every declared
  release file. Verification catches violations before publish rather than at a buyer's first
  download.

## Rejected: DRM on the artifact

Obfuscating or otherwise locking a delivered `.py` file was considered and rejected. The buyer
must be able to read and run the challenge — that is the product. Per-order flags give
**attribution**, not prevention, and the documentation says so plainly rather than implying a
protection that does not exist.
