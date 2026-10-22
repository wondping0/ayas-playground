---
title: 0006 — CTFd-compatible bundle format
always: false
description: Why the bundle is a superset of ctfcli's challenge.yml instead of a bespoke format
---

# 0006 — CTFd-compatible bundle format

**Status:** accepted · **Date:** 2026-09-02

## Context

Every marketplace has to define what is being sold. The tempting move is a bespoke format
tuned exactly to the product.

## Decision

The bundle is a **superset of CTFd `ctfcli`'s `challenge.yml`**, with the
`release_files/` ÷ `server_files/` split from CryptoHack's ctf-archive, and marketplace-
specific fields namespaced under `aya:`.

## Why

- **The buyer's next action is already defined.** They bought a challenge to run an event.
  A ctfcli-shaped folder means `ctf challenge push` and they are done. A bespoke format means
  the buyer writes a converter, and the marketplace has quietly made its own product more
  expensive to use.
- **Sellers already have inventory in this shape.** A challenge from a past event can be
  listed by adding a `solver/` and a writeup, not by re-authoring it.
- **Namespacing under `aya:` keeps it valid.** Unknown top-level keys are the usual way
  formats rot; a single namespaced key means a bundle stays loadable by tools that have never
  heard of this marketplace.

## Consequences

- Fields the marketplace does not use are carried through unchanged rather than dropped, so a
  round trip does not lose data.
- CTFd's format is a moving target; the parser accepts unknown fields rather than rejecting
  them, and only validates what it relies on.
- `solver/` and `writeup.md` are marketplace-required additions and are the two things that
  make a challenge *sellable* rather than merely *runnable*.

## Rejected: importing directly from a CTFd instance in v1

An "import from your CTFd" button is a good v2 feature. It needs credential handling and an
API client for something that only helps sellers who already run CTFd, so it does not earn a
place ahead of the marketplace working end to end.
