"""Recover the keystream from the known pangram, then read the flag."""

PANGRAM = b"the quick brown fox jumps over the lazy dog"

with open("/work/release_files/output.txt") as handout:
    lines = [
        bytes.fromhex(line.strip())
        for line in handout
        if line.strip() and not line.startswith("#")
    ]

assert len(lines) >= 2, "expected several ciphertexts"

# The first message is the pangram, so XORing it against its ciphertext gives
# the keystream — which is the same keystream used for every other line.
keystream = bytes(a ^ b for a, b in zip(lines[0], PANGRAM))

flag = bytes(a ^ b for a, b in zip(lines[-1], keystream))
print(flag.decode())
