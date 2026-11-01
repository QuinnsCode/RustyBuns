# MANUAL RUN: Make local build monster!

> **State at 2026-10-31:** this was drafted when filing was blocked. The builder exists now (`bun run builder`, [MAC_SETUP.md](../MAC_SETUP.md)) and the Mac setup run is #2330. Read what follows as the original plan (#2979).

Drafted as a GitHub issue (filing was blocked); lives here until it is filed.

The goal: build the box, let the agents play in it. Tests are the bottleneck, so we stack safe changes, isolate risky ones, and run on assets we already own. Free hosted Actions stay the final gate; the Macs stay builders we drive, never self-hosted runners on this public repo (a fork PR could run code on them).

Related: [VPS_TEST_RUNNER.md](VPS_TEST_RUNNER.md) (rented Hetzner box, priced), #1242 (parked: hosted fix lane), #1252 (closed: 3 containers, about +$21/mo worst case), #818 (Dockerfiles first-class), #897, #1479 / #1484 (Mervin merges the board in a sandbox, stage by stage).

## Inversion of control

I build the option matrix (tiers, gates, switches). The agents choose the buttons: which tier a change claims, which stack it rides, which gates they want on. The matrix is the keyboard; they play it.

## Part 1: The machines (the manual run)

Needs the owner at the machines.

- Mac Studio (M1 Pro): office host, always on.
- MacBook Pro M1 Max 64GB: Docker builder swarm.
- MacBook Pro M1 Pro 16GB: daily machine, or overflow test builder.

Doing it (2026-10-27): on the 64GB machine run `scripts/builder-setup.sh` (one curl line at its top). It turns on
stay-awake, checks SSH and Docker, makes warm checkouts in `~/builder/slot-N`, times one suite, and prints the two
lines to run on the office Mac. Agents then use `bun run builder` (`scripts/remote-ci.ts`): each run claims a free
slot, pushes the working tree straight to it over SSH (not via GitHub) and runs the tests there. Steps 1, 6 and 7
below are done by that; the rest stay open in #2330.

Steps
1. 64GB machine: raise the Docker Desktop memory limit (default about half of RAM; aim for about 48GB). Keep it awake on power.
2. Build and smoke the three codeSplitter images locally (`sandbox/`, `deploy-sandbox/`, `deploy-sandbox/ci.Dockerfile`). #818 Part 1 will do it; until then plain `docker build -f ... <context>`.
3. Run the office on the Studio; reach it from the other Macs with `office:phone` over Tailscale (`apps/agent-office/README.md`).
4. Time one real rebuild and one `bun test` run per machine, and note memory use under 4-8 parallel containers.
5. Apple Silicon builds arm64 and the hosted containers are x86: check a Rust/cargo build both ways (#760).
6. Shard `scripts/ci-apps.ts` jobs across machines over SSH (each app's suite is independent).
7. Cap parallel test workers per machine (same idea as the typecheck cap of one checker per core).

Open questions
- Workers run on the office host. Sending work to a second Mac needs a remote runner, which is not built (see #818 Part 4's Run on desktop handoff). Is there a multi-host join (URL code + password) I missed?
- Studio RAM?

## Part 2: Risk tiers (cheapest test wins)

| Tier | Touches | Runs |
|---|---|---|
| 0 | Markdown, docs, comments | `bun run docs --check` and the link check |
| 1 | One app's source | That app's touched-file tests, then its suite |
| 2 | `packages/`, lockfile, shared config | All apps (what `apps.yml` does now) |
| 3 | Dev deps, build tooling, CI, Docker images | Its own isolated run, never stacked, plus container smoke |
| 4 | Secrets, deploy, anything destructive | A human gate |

A small classifier over `git diff --name-only`, next to `scripts/ci-apps.ts`.

## Part 3: Stacking

- Tiers 0 and 1 ride together in one test run.
- Tier 3 gets its own run, so a broken dev dep is blamed on the dep.
- When a stacked batch fails, bisect: split in half and rerun, instead of failing every PR in it.
- Mervin builds the waves (tiers 0 and 1 together, tier 3 alone).

## Part 4: Same tiers, two places

- Locally on the Macs, as the agents work.
- On GitHub as the free final gate before merge.

## Part 5: Trust dial

Track each agent's pass rate per tier over a rolling window. An agent with a long clean run on tier 1 gets the targeted run only; a new agent, or one that just broke something, gets the full app suite. Trust is earned and lost.

## Part 6: The box is the test

Each agent works in its own sandbox clone; the sandbox's real checks are what a merge must pass. Tests guard the box's walls, not every individual change.

## Order

1. Tier classifier + stacking rule (one small script and a test).
2. Parts 1 and 4 (the machines and the two gates).
3. Trust dial and the box (Parts 5 and 6), as follow-up issues.
