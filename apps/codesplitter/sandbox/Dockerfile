# The agent sandbox: each coding-agent CLI, and the server that runs one of
# them on one file per request (server.mjs), and bun for a cut's tests. Logins
# come in as environment variables from the Worker's secrets (see AgentSandbox
# in src/sandbox.ts).
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*
# bun runs a cut's tests (POST /test) and the dependency doctor's (POST /deps-test and /deps-fix, src/deps.ts).
RUN npm install -g @anthropic-ai/claude-code @openai/codex @earendil-works/pi-coding-agent opencode-ai bun \
  && npm cache clean --force
# Two users (#646): `node` runs the agent CLI, with its logins; `runner` runs the
# repo's git, install and tests, without them, and can't read node's processes'
# environment or its home. Both write the clones through the `work` group. Git
# works in a clone either one made.
RUN groupadd --gid 1500 work && useradd --uid 1001 --gid 1500 --create-home --shell /usr/sbin/nologin runner \
  && chmod 700 /home/node && git config --system --add safe.directory '*'

WORKDIR /srv
COPY --chmod=644 server.mjs .
EXPOSE 8080
# Egress (#681, src/egress.ts): the Worker gates this container's HTTP and HTTPS,
# reading the HTTPS with a CA the runtime puts in at start. The system store
# takes it (git, curl, codex) and so do Node and Bun (NODE_EXTRA_CA_CERTS). The
# CLIs' telemetry would only be refused, so it's off.
ENV CF_CA=/etc/cloudflare/certs/cloudflare-containers-ca.crt
ENV NODE_EXTRA_CA_CERTS=$CF_CA SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DO_NOT_TRACK=1
# Root, so it can trust the CA and start each command as the user it belongs to (server.mjs); it runs nothing of a repo's itself.
CMD ["sh", "-c", "if [ -f \"$CF_CA\" ]; then cp \"$CF_CA\" /usr/local/share/ca-certificates/ && update-ca-certificates >/dev/null; fi; exec node server.mjs"]
