# The agent sandbox: each coding-agent CLI, and the server that runs one of
# them on one file per request (server.mjs). Logins come in as environment
# variables from the Worker's secrets (see AgentSandbox in src/sandbox.ts).
# Bun is here for the dependency doctor's test runs (POST /test, src/deps.ts).
FROM oven/bun:1.3.0 AS bun
FROM node:22-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code @openai/codex @earendil-works/pi-coding-agent opencode-ai \
  && npm cache clean --force

WORKDIR /srv
COPY --chmod=644 server.mjs .
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
