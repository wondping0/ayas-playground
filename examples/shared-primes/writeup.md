# Shared Primes — intended solution

## The observation

The handout gives two 1024-bit moduli from the same generator run. RSA's security
rests on nobody being able to factor `n`, but factoring is only hard when the
primes are independent. Here they are not: the generator drew from a small pool
and reused one.

`gcd(n1, n2)` is a few microseconds of work and returns the shared prime.

## The solve

```python
p = math.gcd(n1, n2)      # the reused prime
q = n1 // p               # the other factor of n1
d = inverse(e, (p-1)*(q-1))
m = pow(c, d, n1)
```

That is the whole attack. There is no lattice, no Coppersmith, no small-exponent
trick — the difficulty is entirely in noticing that being handed *two* moduli is
a hint rather than decoration.

## Why it is rated easy

Players who have seen the scheme once solve it in under five minutes. Players who
have not usually try Fermat first, because close primes are the other reason
somebody hands you a suspicious modulus. Fermat fails here, which is a useful
dead end: it teaches the difference between "the primes are close" and "the
primes are shared".

## Running it at your event

The bundle is ctfcli-shaped:

```
ctf challenge install .
ctf challenge deploy .
```

The flag in your copy was generated for your order. If you want a different one
for a second event, buy the unlimited licence — that ships `server_files/` so you
can regenerate the handout yourself.

## Where to place it

This works well as the first crypto challenge of an event. It rewards recognising
a scheme rather than implementing anything, so it does not punish teams whose
crypto person arrives late.
