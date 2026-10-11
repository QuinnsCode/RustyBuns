# The deploy container: git, bun, and the server that runs one deploy command per
# request (server.mjs). Separate from the agent sandbox: only this image ever gets
# a repo's deploy key, as CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in its env
# (see DeployRunner in src/deploy-runner.ts). The repo's own `bun install` brings
# @rustybuns/cli. Node is here because the CLI runs Alchemy's `node` bin: under
# Bun's node fallback, alchemy deploy and destroy finish but never exit (#247).
FROM node:22.21.1-bookworm-slim AS node
FROM oven/bun:1.4-slim

COPY --from=node /usr/local/bin/node /usr/local/bin/node

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

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
