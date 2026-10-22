---
title: Cryptography scheme taxonomy
always: false
description: The crypto challenge archetypes a listing is tagged with, and what each implies for buyers and verification — read when touching taxonomy, search facets, or listing metadata
---

# Cryptography scheme taxonomy

A buyer cannot read a crypto challenge before buying it without spoiling it. The **scheme
tag** is therefore the single most load-bearing piece of listing metadata: it is how somebody
decides whether a challenge fits the slot they need to fill in their event, without seeing it.

The taxonomy is data (`src/lib/catalog/taxonomy.ts`), not an enum scattered through the code,
so adding a scheme — or later, a whole category — is a data edit.

## Schemes

| Scheme id | Name | Recognizable by | Typical mechanics |
| --------- | ---- | --------------- | ----------------- |
| `rsa-weakness` | RSA weakness | small `e`, shared/close primes, partial key leak | Håstad, Coppersmith, common modulus, Fermat, Wiener |
| `symmetric-block` | Block cipher misuse | ECB repeats, CBC with an oracle | ECB cut-and-paste, CBC bit-flipping, padding oracle |
| `stream-otp` | Keystream reuse | reused nonce or one-time pad | XOR crib-dragging, many-time-pad |
| `signature` | Signature flaw | repeated or biased nonce in ECDSA/DSA | nonce-reuse key recovery, biased-`k` lattice |
| `classical` | Classical cipher | substitution, transposition | frequency analysis, cipher identification |
| `hash` | Hash weakness | length-extension, collisions, weak MAC construction | length-extension, birthday, MAC forgery |
| `prng` | PRNG prediction | Mersenne Twister output, LCG, weak seeding | state recovery, seed brute-force, lattice on LCG |
| `lattice` | Lattice / knapsack | hidden number problem, truncated LCG, knapsack | LLL, Babai, HNP |
| `ecc` | Elliptic curve | invalid curve, smooth order, singular curve | invalid-curve attack, MOV, Smart's attack |
| `protocol` | Protocol flaw | key exchange, oracle in a handshake | small-subgroup, downgrade, replay |

Two schemes are worth a listing's tags where a challenge genuinely spans both — a lattice
attack on an RSA partial-key leak is honestly `rsa-weakness` + `lattice`.

## Difficulty

Seller-stated: `easy | medium | hard | insane`, corroborated over time by buyer ratings.

**Solver runtime is not difficulty.** A Coppersmith attack that takes four minutes of CPU can
be an easy challenge if the attack is obvious; a five-line `xor` can be brutal if spotting it
is the whole puzzle. The verification record stores duration because it is an operational
fact about the sandbox budget, and the UI must not present it as a difficulty signal.

## Sandbox profiles

| Profile | Contents | For |
| ------- | -------- | --- |
| `python-crypto` | Python 3.12 + pycryptodome, gmpy2, sympy, pwntools | The large majority of challenges |
| `sage` | SageMath | `lattice`, `ecc`, and heavier `rsa-weakness` work |

A listing declares its profile in `challenge.yml`. `sage` is a much larger image with a slower
cold start, so it is opt-in rather than the default.

## What buyers see before purchase

Scheme tags, difficulty, verification badge with date, file manifest (**names and sizes
only**), hint count, writeup length, and reviews. Never handout contents, never the writeup
body, never the solver.

See also: [[bundle-contract]], [[domain-model]].
