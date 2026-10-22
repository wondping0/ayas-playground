"""Recover the flag and print it to stdout.

The sandbox runs this against a freshly generated handout and does NOT tell it
the flag — that is what makes a passing verification mean something.
"""

import math
import re

from Crypto.Util.number import inverse, long_to_bytes

with open("/work/release_files/output.txt") as handout:
    text = handout.read()


def value(name: str) -> int:
    match = re.search(rf"^{name}\s*=\s*(\d+)$", text, re.MULTILINE)
    assert match, f"could not find {name} in the handout"
    return int(match.group(1))


e, n1, n2, c = value("e"), value("n1"), value("n2"), value("c")

# The two moduli share a prime, so their GCD is that prime.
p = math.gcd(n1, n2)
assert 1 < p < n1, "the moduli are coprime — this is not the intended weakness"

q = n1 // p
d = inverse(e, (p - 1) * (q - 1))

print(long_to_bytes(pow(c, d, n1)).decode())
