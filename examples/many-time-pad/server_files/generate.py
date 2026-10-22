"""Encrypt five messages under one keystream, the last being the flag."""

import os
from secrets import token_bytes

FLAG = os.environ["FLAG"].encode()

PANGRAM = b"the quick brown fox jumps over the lazy dog"
MESSAGES = [
    PANGRAM,
    b"meet me where the river bends at half past nine",
    b"burn this after reading, and do not reply to it",
    b"the shipment cleared customs without any trouble",
    FLAG,
]

# One keystream, reused for every message — the entire weakness.
longest = max(len(message) for message in MESSAGES)
keystream = token_bytes(longest)


def xor(data: bytes) -> bytes:
    return bytes(a ^ b for a, b in zip(data, keystream))


with open("output.txt", "w") as handout:
    handout.write("# Five messages. One pad. Somebody was in a hurry.\n")
    handout.write("# The last line is the one worth reading.\n\n")
    for message in MESSAGES:
        handout.write(xor(message).hex() + "\n")
