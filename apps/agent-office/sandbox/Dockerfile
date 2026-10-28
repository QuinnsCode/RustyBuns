# Agent Office in a box. Build from the repo root (the build needs the workspace):
#   docker build -f apps/agent-office/sandbox/Dockerfile -t agent-office-box .
# or let `bun run office:box up` do it, with the permission set from sandbox/box.json (SANDBOX.md).
# pinned: bun 1.4.4 panics in `compile` (index out of bounds) while 1.4.3 builds the same tree
FROM oven/bun:1.4.3 AS src
WORKDIR /repo
COPY . .
# the lockfile and every workspace's package.json, alone: a source change leaves this layer's content as it was,
# so the install below stays cached until a dependency changes
RUN mkdir /manifests && find . -name package.json -not -path '*/node_modules/*' -not -path './.agent-office/*' \
 -exec cp --parents {} /manifests \; && cp bun.lock bunfig.toml /manifests/ && cp -r patches /manifests/

FROM oven/bun:1.4.3 AS deps
WORKDIR /repo
COPY --from=src /manifests ./
RUN bun install --frozen-lockfile

FROM deps AS build
# only the release tarball's download, keyed on release.ts alone (verified again by the build)
COPY apps/agent-office/scripts/release.ts apps/agent-office/scripts/release.ts
RUN cd apps/agent-office && bun -e 'import { PINNED, releaseTarball } from "./scripts/release.ts"; await releaseTarball(PINNED.tag, PINNED.sha256, ".cache")'
COPY --from=src /repo ./
RUN cd apps/agent-office && bun scripts/rustybunsify.ts compile --timings && cp dist/agent-office-linux-* /agent-office

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client gh \
 && rm -rf /var/lib/apt/lists/*
# the agents' CLI; the office starts `claude` in each worker's terminal
RUN useradd -m -u 1000 -s /bin/bash office
COPY --from=build /agent-office /usr/local/bin/agent-office
USER office
# made here, as the office, so it can clone floors into projects/
RUN mkdir -p /home/office/projects /home/office/agent-office
ENV HOME=/home/office PATH=/home/office/.local/bin:$PATH
RUN curl -fsSL https://claude.ai/install.sh | bash
WORKDIR /home/office
EXPOSE 4600
# unauthenticated /login answering is enough to say the office is up
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS -o /dev/null http://127.0.0.1:4600/login || exit 1
# binds 0.0.0.0 inside the box; box.ts publishes it on the host's 127.0.0.1 only
CMD ["sh", "-c", "exec agent-office ${OFFICE_FLOOR:+\"$OFFICE_FLOOR\"} --home /home/office/agent-office --projects /home/office/projects --host 0.0.0.0 --port 4600 --password \"$OFFICE_PASSWORD\" --no-open"]
