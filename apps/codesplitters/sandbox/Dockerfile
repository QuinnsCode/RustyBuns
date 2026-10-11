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
# Root, so it can start each command as the user it belongs to (server.mjs); it runs nothing of a repo's itself.
CMD ["node", "server.mjs"]
