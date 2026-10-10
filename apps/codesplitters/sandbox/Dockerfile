# The agent sandbox: each coding-agent CLI, and the server that runs one of
# them on one file per request (server.mjs), and bun for a cut's tests. Logins
# come in as environment variables from the Worker's secrets (see AgentSandbox
# in src/sandbox.ts).
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*
# bun runs a cut's tests (POST /test).
RUN npm install -g @anthropic-ai/claude-code @openai/codex @earendil-works/pi-coding-agent opencode-ai bun \
  && npm cache clean --force

WORKDIR /srv
COPY --chmod=644 server.mjs .
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
