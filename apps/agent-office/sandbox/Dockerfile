# Agent Office in a box. Build from the repo root (the build needs the workspace):
#   docker build -f apps/agent-office/sandbox/Dockerfile -t agent-office-box .
# or let `bun run office:box up` do it, with the permission set from sandbox/box.json (SANDBOX.md).
# pinned: bun 1.4.4 panics in `compile` (index out of bounds) while 1.4.3 builds the same tree
FROM oven/bun:1.4.3 AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile && cd apps/agent-office && bun scripts/rustybunsify.ts compile \
 && cp dist/agent-office-linux-* /agent-office

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
