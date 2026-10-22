---
title: Glossary
always: false
description: Domain terms used in this codebase and what they precisely mean
---

# Glossary

**Bundle** — the on-disk artifact a seller uploads: `challenge.yml`, release files, server
files, solver, writeup. See [[bundle-contract]].

**Bundle hash** — content hash of a `ChallengeVersion`. Verification binds to it; if it
changes, the verification is void.

**Build** — producing release files for a given flag, by the version's flag mode. Not
"compiling" anything.

**Verify** — running the seller's solver against a freshly built challenge and asserting it
recovers the flag. Produces the "Verified solvable" badge.

**Fulfill** — building for a *buyer's* flag and packaging the deliverable. Same sandbox
primitive as build, different caller and different flag.

**Forge** — the plane that owns the sandbox. Never a build tool.

**Flag mode** — `static`, `substitute`, or `generate`. Determines how a bundle is re-flagged.

**Derived flag** — a buyer's flag, computed as `KDF(secret, version + order)`. Never stored.

**Ephemeral flag** — a throwaway random flag used during verification only.

**Scheme** — a crypto challenge archetype (`rsa-weakness`, `lattice`, …). The primary way a
buyer filters. See [[crypto-taxonomy]].

**Profile** — a sandbox image: `python-crypto` or `sage`.

**Release files** — what the buyer's players receive. **Server files** — secret, never
delivered to players.

**Dispute window** — 72h after `delivered`, during which a refund is possible and the
seller's balance stays `pending`.

**Listing** vs **Challenge** vs **ChallengeVersion** — commercial wrapper vs authored thing
vs immutable snapshot. See [[domain-model]].

See also: [[architecture]], [[domain-model]].
