# Many Time Pad — intended solution

## The observation

XOR encryption with a reused keystream is not encryption. If `c1 = m1 ⊕ k` and
`c2 = m2 ⊕ k`, then `c1 ⊕ c2 = m1 ⊕ m2` — the key cancels and you are left
staring at two plaintexts XORed together.

Normally that is where crib-dragging starts. Here the challenge hands you a
shortcut: it says outright that one of the messages is a pangram every typist
knows.

## The solve

```python
keystream = xor(ciphertexts[0], b"the quick brown fox jumps over the lazy dog")
flag      = xor(ciphertexts[-1], keystream)
```

The pangram is 43 bytes, which bounds how much keystream you recover. That is
deliberate: the flag is shorter, so full recovery is possible, but a player who
guesses a *longer* crib gets nothing extra and a player who guesses a shorter one
gets a truncated flag and has to think about why.

## The dead end worth having

Most players first try `c1 ⊕ c5` and stare at the result. It looks like noise
because both operands are unknown. The realisation that one plaintext being known
collapses the whole problem is the actual lesson, and it lands harder after a few
minutes of the wrong approach.

## Why it is rated easy

There is no statistics and no tooling. If a player knows what a many-time pad is,
this is five lines. If they do not, the description tells them enough to work it
out.

## Placing it

Pair it with a harder keystream challenge later in the same event — this one
teaches the technique that the harder one then requires without hand-holding.
