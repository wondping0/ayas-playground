# The sandbox image for the `sage` profile — lattice, ECC, and heavier RSA work.
#
# Opt-in per challenge: it is roughly two orders of magnitude larger than the
# python-crypto image and has a much slower cold start, so it is not the
# default. The isolation flags are identical; see the note in
# ../python-crypto/Dockerfile.
FROM sagemath/sagemath:10.4

USER root
RUN /home/sage/sage/local/bin/pip install --no-cache-dir --disable-pip-version-check \
      pycryptodome==3.21.0 || true

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPYCACHEPREFIX=/tmp/pycache \
    HOME=/tmp \
    DOT_SAGE=/tmp/sage

USER 65534:65534
WORKDIR /work

# `python` resolves to Sage's interpreter, so a solver's shebang and the
# orchestrator's `python <script>` both land in the same place.
ENTRYPOINT []
CMD ["python", "--version"]
