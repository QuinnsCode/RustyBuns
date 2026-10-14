# Plan: the M1 Max 64GB as a local builder

Status as of 2026-10-14. Part 1 of [local-build-monster.md](local-build-monster.md) says what the 64GB MacBook Pro is for
(the Docker builder). This note is how to start, in order, and which open issues it touches.

The rule from that note stands: the Max is a builder we drive. It is never a self-hosted GitHub runner on this public
repo, because a fork PR could run code on it. Free hosted Actions stay the final gate.

## Where things stand

| Issue / PR | State | What it gives the builder |
|---|---|---|
| [#818](https://github.com/QuinnsCode/RustyBuns/issues/818) Dockerfiles first-class | open, no part shipped | `rustybuns containers build/run/smoke` and `--prod-like`: the builder's main job |
| [#1242](https://github.com/QuinnsCode/RustyBuns/issues/1242) rebuilds wait behind feature runs | open (parked) | the Max takes rebuilds, so they stop waiting on the 2 hosted `AGENT_SANDBOX` slots |
| [#1400](https://github.com/QuinnsCode/RustyBuns/issues/1400) Ship pop-out Build and Plan | open | Build and Plan are desktop-only today; the Max already runs them |
| [#1477](https://github.com/QuinnsCode/RustyBuns/issues/1477) Mervin settles dependencies in a sandbox | open | install-and-build of a merged tree is the heaviest local job |
| [#1640](https://github.com/QuinnsCode/RustyBuns/issues/1640) smoke on a bare `Bun.serve` app | open | smoke must reach `works` on the Max before it is trusted |
| [#897](https://github.com/QuinnsCode/RustyBuns/issues/897) sandbox on Linux | open | not for the Max (Seatbelt already works on macOS); skip |
| [#1141](https://github.com/QuinnsCode/RustyBuns/issues/1141) `shadow --check` over every git-only merge | open | long, parallel, CPU-bound: a good first soak job |
| [#609](https://github.com/QuinnsCode/RustyBuns/issues/609) manual-run checklist | open | the machine setup below is a manual run; add it there |
| PRs [#1668](https://github.com/QuinnsCode/RustyBuns/pull/1668), [#1669](https://github.com/QuinnsCode/RustyBuns/pull/1669), [#1666](https://github.com/QuinnsCode/RustyBuns/pull/1666) | in progress (Byte, Bolt, Nibble) | unrelated to the builder; they are what the builder will run tests for |

Closed and merged, already usable: #1252 (3 containers), #760 (desktop watch loop, x86 Rust crates in the hosted
container), #1479 (Mervin merges the PR board in a sandbox), #896 (dev-host lockdown).

Everything else open (#1594, #1580, #1572, #1544, #1521, #1515, #1494, #1483, #1428, #1365, #1343, #1052, #1013, #967,
#851, #850, #840, #740, #318) does not depend on the builder.

## Start here (one sitting, about an hour)

This session's machine is an M1 Pro 16GB, so these steps are for the owner at the Max.

1. Power and sleep: plug in, then `sudo pmset -c sleep 0 disablesleep 1` (or run `caffeinate -s` in a pane).
2. Docker Desktop, Settings, Resources: memory about 48GB, CPUs all 10, swap 4GB, disk 120GB+. The default is about half
   the RAM, which wastes the machine.
3. Checkout: a separate clone for the builder (`~/builder/RustyBuns`). Do not use the working copy in
   `~/Documents/projects/RustyBuns`.
4. Install: `bun install` at the root. Check `docker info --format '{{.MemTotal}}'` reports about 48GB.
5. Build the three images with plain `docker build`, with the contexts from the Dockerfiles' own paths:
   `apps/codesplitter/sandbox/`, `deploy-sandbox/`, and `deploy-sandbox/ci.Dockerfile`. Write down time and image size for each.
   Add `--platform linux/amd64` to each once to see the emulation cost (hosted containers are x86; the Max builds arm64).
6. Baseline timings, written into the table at the bottom of this file:
   - `cd apps/codesplitter && bun test --parallel test` (cold, then warm)
   - one `rustybuns build desktop --dev` for `agent-office`
   - one rebuild of the biggest container image
7. Memory under load: run 4, then 8 sandbox containers at once (`docker stats --no-stream`), and note where swap starts.

Stop at step 7 and read the numbers before building anything more. Those numbers set the worker cap in the next section.

## Then, in this order

1. **Tier classifier** (first step of local-build-monster): a small script next to `scripts/ci-apps.ts` that reads
   `git diff --name-only` and prints tier 0 to 4. One test file. No machine needed; any agent can do it.
2. **Worker cap**: a per-machine limit on parallel test workers and containers, set from the step 7 numbers. A config
   value, not a constant, so the 16GB Macs can use a lower one.
3. **Remote runs over SSH**: `scripts/ci-apps.ts test <base>` already lists the apps a PR touched, and each app's suite is
   independent. A script runs those suites on the Max over SSH (Tailscale name), streams results back, and exits with the
   worst code. Read-only on the PR: it never pushes.
4. **#818 Part 1** (`rustybuns containers`): replaces step 5's hand-written `docker build`. Part 2 (CI build of touched
   images) can ship first on plain `docker build` as the issue says.
5. **Mervin on the Max**: point the #1479 board merge's sandbox at the local Docker, so #1477's install-and-build
   stage has a cheap place to run. Price it first: no cloud cost, but cap passes per repo.
6. **#1242**: once the Max takes rebuilds, close it as "lane moved to the Max", or keep it open if hosted rebuilds still matter.

Trust dial and "the box is the test" (Parts 5 and 6 of local-build-monster) wait for real pass-rate data from steps 1 to 3.

## Risks

- arm64 versus x86: a green Max build does not prove the hosted x86 container builds. Keep one `--platform linux/amd64`
  run per image in the loop and keep CI the gate.
- Thermals and battery: the Max throttles when the lid is closed on battery. Keep it on power, lid open or in clamshell with a display.
- Secrets: the builder never gets 1Password, varlock output, or deploy keys. It runs tests and builds only; deploys stay
  with the owner.
- Public-repo PRs run untrusted code: run PR branches inside the sandbox (#896 Seatbelt or a container), not bare on the host.

## Numbers (fill in at step 6 and 7)

| Job | M1 Max 64GB | M1 Pro 16GB | CI |
|---|---|---|---|
| codesplitter `bun test --parallel`, cold | | | |
| codesplitter `bun test --parallel`, warm | | | |
| `sandbox/` image build | | | |
| `deploy-sandbox/` image build | | | |
| `ci.Dockerfile` build | | | |
| 4 containers: peak memory | | | |
| 8 containers: peak memory, swap | | | |
