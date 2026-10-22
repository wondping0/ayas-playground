# The sandbox image for the `python-crypto` profile.
#
# It is run with no network, a read-only root filesystem, all capabilities
# dropped, and as nobody. Those controls come from the argv builder
# (src/lib/forge/docker-args.ts), NOT from this file — an image cannot be
# trusted to constrain the code it runs.
#
# What this file is responsible for is being a *usable* environment under those
# constraints: no writes outside /tmp and /out, and no attempt to reach the
# network at run time.
FROM python:3.12-slim

# Pinned. A solver that passed verification must run the same way at fulfilment,
# and a floating dependency makes those two different environments.
RUN pip install --no-cache-dir --disable-pip-version-check \
      pycryptodome==3.21.0 \
      gmpy2==2.2.1 \
      sympy==1.13.3

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPYCACHEPREFIX=/tmp/pycache \
    # `nobody` has no home directory, and the root filesystem is read-only.
    HOME=/tmp \
    MPLCONFIGDIR=/tmp

USER 65534:65534
WORKDIR /work

# Never a shell: the orchestrator always passes an explicit argv.
ENTRYPOINT []
CMD ["python", "--version"]
