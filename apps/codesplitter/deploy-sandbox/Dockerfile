# The deploy container: git, bun, and the server that runs one deploy command per
# request (server.mjs). Separate from the agent sandbox: only this image ever gets
# a repo's deploy key, as CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in its env
# (see DeployRunner in src/deploy-runner.ts). The repo's own `bun install` brings
# @rustybuns/cli. Node is here because the CLI runs Alchemy's `node` bin: under
# Bun's node fallback, alchemy deploy and destroy finish but never exit (#247).
#
# Rust is here so an x86 Hetzner box's native/ crates compile in the run (#373):
# `rustybuns build box` builds them with this cargo when the repo has no
# native/dist/<crate>/linux-x64/ build. gcc is its linker. There is no Docker,
# so a cax (arm64) box's crates still need the desktop (src/preview.ts refuses).
FROM node:22.23.4-bookworm-slim AS node
FROM rust:1.96.0-slim-bookworm AS rust
FROM oven/bun:1.4.4-slim

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=rust /usr/local/rustup /usr/local/rustup
COPY --from=rust /usr/local/cargo/bin /usr/local/cargo/bin

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git gcc libc6-dev \
  && rm -rf /var/lib/apt/lists/*
# The toolchain is read-only; cargo's registry and git caches go in the writable /work.
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/work/.cargo PATH=/usr/local/cargo/bin:$PATH

WORKDIR /srv
COPY --chmod=644 server.mjs .
RUN mkdir /work && chown bun:bun /work
USER bun
EXPOSE 8080
# Egress (#681, src/egress.ts): the Worker gates this container's HTTP and HTTPS,
# reading the HTTPS with a CA the runtime puts in at start. Node and Bun take it
# through NODE_EXTRA_CA_CERTS; git through a bundle made at start, since `bun`
# can't write the system store. Telemetry would only be refused, so it's off.
ENV CF_CA=/etc/cloudflare/certs/cloudflare-containers-ca.crt
ENV NODE_EXTRA_CA_CERTS=$CF_CA GIT_SSL_CAINFO=/tmp/ca.pem SSL_CERT_FILE=/tmp/ca.pem \
  DO_NOT_TRACK=1 WRANGLER_SEND_METRICS=false
# Under Node, not Bun: under Bun the server sometimes stopped answering once a
# long command (bun install) exited (#247).
CMD ["sh", "-c", "cat /etc/ssl/certs/ca-certificates.crt \"$CF_CA\" > /tmp/ca.pem 2>/dev/null; exec node server.mjs"]
