# The check container (#750): git, bun, and the deploy image's server (server.mjs),
# which runs one command per request. CiRunner (src/ci-runner.ts) starts one per
# check run: clone, lay a branch's files over it, run the check's command, destroy.
# It shares this folder with the deploy image only for server.mjs: it is its own
# image and binding (CI_RUNNER), and gets no secrets at all, so a repo's checks
# never sit next to a deploy key or an agent's login. No Rust or Docker, so a check
# that needs them runs on the desktop or a runner of your own instead.
FROM node:22.23.4-bookworm-slim AS node
FROM oven/bun:1.4.4-slim

COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY --chmod=644 server.mjs .
RUN mkdir /work && chown bun:bun /work
USER bun
EXPOSE 8080
# Egress (#681, src/egress.ts): only the clone and the package registries, through
# the Worker's gate, which reads the HTTPS with a CA the runtime puts in at start.
ENV CF_CA=/etc/cloudflare/certs/cloudflare-containers-ca.crt
ENV NODE_EXTRA_CA_CERTS=$CF_CA GIT_SSL_CAINFO=/tmp/ca.pem SSL_CERT_FILE=/tmp/ca.pem DO_NOT_TRACK=1
# Under Node, not Bun, as in the deploy image (#247).
CMD ["sh", "-c", "cat /etc/ssl/certs/ca-certificates.crt \"$CF_CA\" > /tmp/ca.pem 2>/dev/null; exec node server.mjs"]
