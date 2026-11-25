# Test swarm

A queue of test jobs that any of our Macs pulls from when GitHub Actions is slow ([#4758](https://github.com/QuinnsCode/RustyBuns/issues/4758)).
An agent queues a commit's suites (rows of `scripts/ci-apps.ts`: `typecheck`, an app, or an app's shard), a runner leases one,
runs it and reports. When every suite of a commit is green, the Worker posts the `typecheck` and `apps` commit statuses on GitHub.

- **Only ours**: every route takes the swarm token (`SWARM_TOKEN`). No fork's code reaches a runner, so this is not a
  GitHub self-hosted runner (`scripts/ci-guard.ts`).
- **Leases run out**: a runner that goes quiet (a Mac asleep) loses its job at the end of its lease, and the next runner takes it.
  A long suite keeps its lease with `/extend`. A report after the lease ran out doesn't count.
- **Statuses once**: a failed suite turns its status red at once (`typecheck` for typecheck, `apps` for the rest); queuing the
  commit again reruns the named suites and clears what was posted.

| Route | Body | Answer |
| --- | --- | --- |
| `POST /enqueue` | `{ sha, branch, suites }` | `{ queued }` |
| `POST /lease` | `{ runner, seconds? }` (default 600) | `{ job }` or `{ job: null }` |
| `POST /extend` | `{ lease, seconds? }` | `{ ok }`, 409 when the lease ran out |
| `POST /report` | `{ lease, ok, log }` | `{ ok }`, 409 when the lease ran out |
| `GET /jobs?sha=` | | each suite's state, runner, tries and log tail |
| `GET /queue` | | every queued and leased job in lease order: sha, branch, suite, runner, lease end |

The shapes are guards in [src/api.ts](src/api.ts); the runner's side is [src/runner.ts](src/runner.ts).

## Using it

With `SWARM_URL` (the Worker) and `SWARM_TOKEN` set in the shell:

- **Send a branch**: `bun run builder queue [base-ref]` queues the pushed HEAD's suites, the same ones both required checks
  run. `bun run builder` does it on its own when it finds no builder, and `bun run pr <n>` says so when GitHub hasn't started.
- **Join with a Mac**: `bun run builder join --slots 1` (raise it once one is fine). Each slot is a clone in
  `~/.rustybuns/swarm/slot-N` (`SWARM_DIR`); it fetches the job's SHA from GitHub, installs, looks the suite up with
  `scripts/ci-apps.ts` at that commit, runs it, extends its lease while it runs and reports the last 4000
  characters of its log. Ctrl-C stops the running suites; their leases run out and the jobs go back on the queue.

Tests (`bun test test`): two fake runners with a lease that runs out and a stub GitHub, then a Mac with two slots on a
local git repo. `bun run builder queue` and `GET /jobs?sha=` are how you watch it; no page (#4779 closed: Bob over ssh is what runs our tests).

## Cost

One Worker and one Durable Object on the Workers paid plan. Nothing runs on its own: no alarms, no crons, no stored
files. It costs money only when it gets a request. An idle joined slot asks once every 2 min at most (it backs off from
15 s), which is about 22,000 requests a month. A busy slot also extends its lease every 200 s. Ten slots left on for good
come to well under the 1 million Durable Object requests the plan includes. The tests run on our own Macs, and the
statuses go to GitHub for free.

Deploying is the owner's: `bun run deploy` in this folder, with `SWARM_TOKEN` and `GITHUB_STATUS_TOKEN` in 1Password
(names in `.env.schema`).
