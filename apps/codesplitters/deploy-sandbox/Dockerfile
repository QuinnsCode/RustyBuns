# The deploy container: git, bun, and the server that runs one deploy command per
# request (server.mjs). Separate from the agent sandbox: only this image ever gets
# a repo's deploy key, as CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in its env
# (see DeployRunner in src/deploy-runner.ts). Nothing else is installed: the repo's
# own `bun install` brings @rustybuns/cli.
FROM oven/bun:1.4-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY --chmod=644 server.mjs .
RUN mkdir /work && chown bun:bun /work
USER bun
EXPOSE 8080
CMD ["bun", "server.mjs"]
