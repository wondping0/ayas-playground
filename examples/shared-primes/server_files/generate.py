"""Generate this challenge's handout for a given flag.

Run by the sandbox with $FLAG set and the writable output directory as the
working directory, so an ordinary relative `open(...)` lands in the right place.

The whole point: because the flag is an input, every buyer receives a different
`output.txt` and a leaked flag identifies whose copy it came from.
"""

import os

from Crypto.Util.number import bytes_to_long, getPrime

FLAG = os.environ["FLAG"].encode()
E = 65537

# The mistake being modelled: one prime is reused across two moduli, so their
# GCD hands you the factorisation of both.
shared = getPrime(512)
q1 = getPrime(512)
q2 = getPrime(512)

n1 = shared * q1
n2 = shared * q2

m = bytes_to_long(FLAG)
assert m < n1, "flag is too long for a 1024-bit modulus"
c = pow(m, E, n1)

with open("output.txt", "w") as handout:
    handout.write("# Two public keys from the same generator run.\n")
    handout.write("# The message was encrypted under the first one.\n\n")
    handout.write(f"e  = {E}\n")
    handout.write(f"n1 = {n1}\n")
    handout.write(f"n2 = {n2}\n")
    handout.write(f"c  = {c}\n")
