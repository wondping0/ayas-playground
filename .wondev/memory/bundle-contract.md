---
title: Challenge bundle contract
always: false
description: The on-disk format a seller uploads — directory layout, challenge.yml fields, and the three flag modes — read before touching parsing, building, or fulfillment
---

# Challenge bundle contract

The format is a **superset of CTFd's `ctfcli` `challenge.yml`**, borrowing the
release/server file split from CryptoHack's ctf-archive. Compatibility is a feature, not an
accident: a purchased bundle should drop into a buyer's CTFd via `ctf challenge push` with no
translation step.

## Layout

```
<bundle>/
├── challenge.yml         # metadata, ctfcli-compatible superset
├── release_files/        # player-facing handout — chall.py, output.txt
├── server_files/         # secret; never delivered to players
│   └── generate.py       # reads $FLAG, writes release_files/   (mode: generate)
├── solver/
│   └── solve.py          # MUST print the flag to stdout
└── writeup.md            # author's solution; delivered to the BUYER, never public
```

`solver/` and `writeup.md` are required to list. They are what make the challenge verifiable
and what the buyer is actually paying for beyond the handout.

## challenge.yml

ctfcli fields carried through unchanged: `name`, `author`, `category`, `description`,
`attribution`, `value`, `type`, `tags`, `topics`, `hints`, `files`, `connection_info`,
`state`, `version`.

Fields this marketplace adds, all under `aya:`:

```yaml
aya:
  scheme: rsa-weakness       # see [[crypto-taxonomy]]
  difficulty: medium         # easy | medium | hard | insane
  flag:
    mode: generate           # static | substitute | generate
    format: "ayactf{%s}"     # buyer-overridable at checkout
  solver:
    entrypoint: solver/solve.py
    profile: python-crypto   # python-crypto | sage
    timeoutMs: 60000
  license: event             # practice | event | unlimited
```

A literal flag in `challenge.yml` is **rejected at parse time** unless `mode: static`. This
catches the most common authoring mistake before it reaches a sandbox.

## The three flag modes

This is the part that is specific to selling crypto, and the reason the sandbox is on the
fulfillment path.

| Mode | Mechanism | When |
| ---- | --------- | ---- |
| `static` | Flag is fixed; the bundle ships as uploaded. | Legacy imports. The challenge cannot be re-flagged, so it is worth less and the UI says so. |
| `substitute` | `{{FLAG}}` token is replaced in declared text files. | Simple challenges where the flag appears verbatim. |
| `generate` | `server_files/generate.py` runs with `$FLAG` in env and rewrites `release_files/`. | **The real crypto case.** |

### The generator's contract

The generator runs with the bundle mounted **read-only** at `/work` and an empty writable
directory as its **working directory** (also exported as `$OUT_DIR`). So an author's ordinary
`open("output.txt", "w")` lands in the right place without them knowing anything about the
sandbox.

That working-directory choice is load-bearing: run the generator in `/work` instead and its
first write fails with `EROFS`. `RunSpec.workdir` carries it, and `verify.test.ts` asserts the
generate step asks for `out` while the solver step does not — a fake runner that writes wherever
it likes will not catch a regression here on its own.

`generate` exists because a crypto flag is not *present* in the handout — it is *encrypted
into* it. You cannot find-and-replace a flag inside an RSA ciphertext; you have to re-run the
generator. That single fact is why fulfillment is a queued sandbox job rather than a file
copy, and why `generate` mode is worth its complexity: without it, every sale of a challenge
ships the same flag, and the first buyer's leak burns it for everyone.

## Lifecycle of a bundle

1. **Inspect** — extract safely (see the archive rules in [[security-guardrails]]), parse
   `challenge.yml`, check required paths, compute `bundleHash`.
2. **Build** — mint an ephemeral flag, run the mode's mechanism in the sandbox, produce
   release files.
3. **Verify** — run `solver/solve.py` in the sandbox against the built release files, assert
   stdout contains the ephemeral flag. Record duration.
4. **Publish** — allowed only on a `passed` verification matching the current `bundleHash`.
5. **Fulfill** — rebuild with the buyer's derived flag and their chosen format, package with
   `writeup.md` and a `LICENSE.txt`, hand to Commerce.

Steps 2, 3, and 5 are the same sandbox primitive with different inputs.

## Rejection reasons a seller sees

Missing `solver/` · missing `writeup.md` · literal flag with a non-static mode · declared
`files` that do not exist · archive that fails the traversal/size checks · a `generate` mode
whose generator does not write every declared release file · a solver whose stdout does not
contain the flag.

See also: [[architecture]], [[crypto-taxonomy]], [[security-guardrails]], [[decisions/0003-flag-modes]].
