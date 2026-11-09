# Moving Agent Office into codeSplitter

Plan for [#1384](https://github.com/QuinnsCode/RustyBuns/issues/1384): the office (workers, 📋 queue, 🔀 PR board)
becomes a [codeSplitter](../codesplitter) feature instead of the separate Bun binary in this folder. This page is
steps 1 and 2 of the issue (what the preview is, what has to move) plus the cut-over and rollback of step 3.
Nothing here is built yet (#1384 was closed without it; the open tracker is [#3423](https://github.com/QuinnsCode/RustyBuns/issues/3423), which replaced the closed #2952), and the live office keeps running untouched until the cut-over.

## The catch

The PR agent that repairs things runs on the office being moved. Cutting over while it works would cut off the agent
that could fix a bad cut-over. So the old binary stays up, with its PR agent, until the preview has run a full merge
round alone.

## 1. The ephemeral preview

The stage and its runbook exist: [PREVIEW.md](PREVIEW.md) (#1385).

A separate codeSplitter stage, never the live one:

- Its own Alchemy stage (e.g. `office-preview`) with its own resource names, so `destroy` removes only the preview.
  Nothing in it is `protect: true`; read the KEPT/REMOVED list before the destroy run (#1381).
- Smallest resources: the office's state is Durable Object storage, not a new database, and workers run in the
  `AgentSandbox` instance type already in `wrangler.jsonc`. Price it against `COSTS.md` first and put the estimate on
  the PR that builds it.
- A throwaway repo and throwaway queue, never `QuinnsCode/RustyBuns`, and a throwaway token scoped to that one repo,
  delivered through varlock like every other deploy secret (the owner runs the deploy).
- Deploy flags as for any codeSplitter deploy: `DEPLOYS=1 AGENTS=1 CHECKS=1`.
- Destroy it after verifying. Each line below is recorded on the PR:
  1. hire a worker (one `AgentSandbox` run) and see it at a desk;
  2. add a task to the queue; the worker takes it, opens a PR on the throwaway repo, and the PR shows on the board;
  3. the merge flow: a wave of two PRs, one conflicting, repaired by the conflict agent (`src/conflict-agent.ts`) and
     merged by the Mervin engine (`src/merge-plan.ts`);
  4. the rebuild flow: "rebuild #N" becomes its own task (#1235) and the worker merges main in;
  5. worker identity (#942): each worker's edits and commits carry its own name in blame and on the board
     (`src/identity.ts`).

## 2. What has to move

The office is a **control plane** (state and decisions) and **machines** (terminals and worktrees). Only the first
moves cleanly into a Worker.

| Office piece (now) | Becomes | Notes |
|---|---|---|
| Queue, desks, worker roster, `workers.json` (hashed hook tokens, #642) | A Durable Object in codeSplitter | One per floor, strongly consistent. Hook tokens stay hashed. |
| 🔀 PR and 📌 issue boards (`live/github.ts` polling `gh`, optional `gh webhook forward`) | codeSplitter's own branch and PR model (`src/branches.ts`, `src/github.ts`) and its webhooks | Drops the `gh` polling: codeSplitter already holds the PRs. |
| Dispatch hint, "hung in X" annotation, Wait hold (`codesplitter/`, #1187, #1218, #1356) | In-process calls | Today they go over HTTP; inside, the Settings toggle goes away. |
| Merge waves, rebuilds, the `rebuild-pr` recipe | codeSplitter's merge engine and conflict agent | The office asks for them today; they become its native path. |
| `floorguard` rules (people-only, ask-first, tell/hire/home guards, #644) | Same rules in the DO's tool handlers | Port with their tests (`apps/agent-office/test`) before cut-over. |
| Secret-dropping filter (`live/env.ts`) | The `AgentSandbox` container's setup | The container already keeps agent logins away from repo code (#646). |
| 3D client, `/lite`, Druids Curse skin, icons, clock, power, queue search, whiteboard | Static assets on the codeSplitter Worker | Still built by `scripts/rustybunsify.ts`; its output is uploaded. The socket protocol is kept, so the client is unchanged. |
| `/__rb/mem` and `triage/` | Workers observability | Heap snapshots and CPU profiles of a Bun process have no Worker equivalent; `triage/` stays for the local office. |
| **Worker terminals** (node-pty shim, detached pty host) | `AgentSandbox` container sessions | Needs a PTY over WebSocket from the container; `sandbox/server.mjs` has none today. The biggest new piece. |
| **Git worktrees** on the owner's disk | A clone per worker in its container, pushed to the repo | No shared `.git`, so the AGENTS.md shared-worktree rules don't apply to hosted workers. |
| Agent logins | Container settings from varlock-resolved secrets | Never in the DO's storage. |

### What stays local

- The owner's desktop office, for work on a real checkout (`~/Documents/projects/RustyBuns`): terminals and worktrees
  there are the point, and a container can't replace "agents push, I pull and deploy".
- `office:phone`, `office:mama`, `office:update` and the binary build (`desktop:build`).
- `triage/` profiling.

The end state is two front doors onto one control plane: the local binary for hands-on work, and codeSplitter's hosted
office for unattended workers, the board and merging. Cut-over moves the board, queue and merge engine, not the owner's
terminals.

### Gaps to close before building

1. PTY over WebSocket in the sandbox container (terminals in the 3D office).
2. Container lifetime: a worker's session must survive a deploy and a sleeping container, as the pty host does today.
3. Cost: container hours per worker is the open number; set a per-floor cap (`src/budget.ts`) before enabling.
4. Auth: the office password and accounts map to codeSplitter's sign-in; `identity.ts` decides who is a person and
   who is a worker.

## Build order (priced)

The plan round from [#3423](https://github.com/QuinnsCode/RustyBuns/issues/3423) (2026-11-09). Each slice is one PR
against `main`, tried on the `office-preview` stage, and works without the slices after it. The owner chooses which
slice comes first.

**Rates used** (Workers Paid, read 2026-11-08; check them before a deploy): Durable Objects get 1M requests and 400k GB-s
of duration a month included, then $0.15 per million requests and $12.50 per million GB-s. An object bills 128 MB only
while it is awake; hibernating sockets cost nothing while they sit idle. Static assets cost nothing per request.
Container rates are the ones in [#3102](https://github.com/QuinnsCode/RustyBuns/issues/3102): memory
$0.0000025/GiB-s, CPU $0.000020/vCPU-s (busy time only), disk $0.00000007/GB-s, billed only while the container runs.

**Biggest a floor can cost:** one floor's object awake every second of a month is 30 × 86,400 s × 0.125 GB = 324k GB-s,
which is under the 400k included. So slices 1 and 2 add $0 past the $5 plan for one floor. Each extra floor that is
always awake costs about $4 a month. Containers are the only part that can run up a real bill, which is why slice 6,
the cap, ships before any container is left running.

| # | Slice | What a person sees | New resources | Fan-out to count | Price a month |
|---|---|---|---|---|---|
| 1 | **Office DO: queue, desks, roster** | `/office/<floor>` on the preview answers with the floor's state. Tasks can be added, reordered and cleared through it, and the roster and desks persist across deploys. | One SQLite-backed DO class (`OfficeFloor`), one object per floor, sockets hibernating (`ctx.acceptWebSocket`). Nothing else: no D1 tables, no queue. | One object per floor. Floor names are checked in the Worker before `idFromName`, so a junk URL makes no object. Each hook post and socket message is one request. | **$0** for one floor, inside the included usage. |
| 2 | **3D client served from the Worker** | The Druids office opens in a browser from the preview's URL and shows slice 1's queue and desks live. | None. `scripts/rustybunsify.ts`'s `dist/public` gets uploaded as static assets beside `dist/client`. | None. Asset requests are free. | **$0** |
| 3 | **Desks run codeSplitter agents** (new, no PTY) | Hire puts an `AgentSandbox` run at a desk: it takes the task, edits line by line under its own name (`src/agent-run.ts`, `src/identity.ts`) and the board shows the branch. You watch the run's output, not a terminal. | None new. It uses the `AgentSandbox` container already in `wrangler.jsonc` (`basic`, `max_instances: 2`). | One container per hired worker, at most 2 at once. | Per hour busy: about $0.03 on `basic`. A preview pass with checks 1 to 5 stays under $1 (PREVIEW.md). The model's tokens cost more than the container. |
| 4 | **PTY over WebSocket** | A desk's terminal in the 3D office is the container's real shell. | A PTY server in `sandbox/server.mjs` (it has none today). The socket runs browser → Worker → container. | One open terminal keeps its container and the floor's object awake. | Container time while a terminal is open (see slice 5). The object's time stays inside the included usage for one floor. |
| 5 | **Container lifetime** | A worker's session survives a deploy and a sleeping container. | `sleepAfter` on the sandbox class (it sets none today). The worker's clone is pushed to a branch before the container sleeps and pulled back when it wakes. | Same as 3 and 4. | A worker kept alive all day on `basic` costs about $0.01 an hour idle, $0.03 an hour busy. If Claude Code, `bun test` and git don't fit in 1 GiB, `standard-1` costs about $0.04 an hour idle and $0.07 busy. An 8-hour day is $0.30 to $0.60 per worker. |
| 6 | **Per-floor cost cap** | The floor refuses a hire once this month's container time reaches its cap, and tells you so. | A counter in the floor's object, fed by run start and stop times (the D1 cost-counter pattern from #3102). | None. | $0. **Suggested cap: $5 a month per floor**, which buys about 160 worker-hours on `basic`, plus a 2-hour cap on a single run. Owner's call. |
| 7 | **Auth mapping** | Sign in with codeSplitter's account instead of the office password. People and workers are told apart by `identity.ts`, and the floorguard rules (people-only, ask-first, overlap) run in the object's handlers. | None. | None. | $0 |

Until slice 7 lands, the preview's `/office` routes accept only the signed-in owner. The upstream office (by
WebDevCody) is MIT, which lets us serve its client from our Worker as long as its notice goes with it: slice 2 ships
its `LICENSE` at `/office/LICENSE.txt` and a credits page at `/office/credits.html` (checked 2026-11-08). The owner
means to tell WebDevCody before the preview goes up anyway (MANUAL RUN #4062).

**Slice 2 as built.** `rustybuns deploy` passes the stage to the build (`RUSTYBUNS_STAGE`), and codeSplitter's
`build.ts` adds the office only for `office-preview` (`src/office-client.ts`): it prepares `apps/agent-office` from
the pinned release, copies `dist/public` to `dist/client/office/`, and moves the client's paths there (`/assets`,
`/druids`, `/ws` -> `/api/office/ws?floor=`, `/api/*` -> `/api/office/*`), failing the build if a release moves one.
Every other stage's build removes it. The floor's welcome carries the rest of what the client draws (one floor, you,
each board empty), and the socket drops the client messages the floor doesn't keep yet, as upstream does. To see it
without a deploy: `bun scripts/office.ts --seed` in `apps/codesplitter`.

**Why this order:** slices 1 to 3 give the board, queue and hosted workers with no new kind of resource and no
always-on container. That covers PREVIEW.md's checks 1, 2 and 5 without a terminal. Slices 4 and 5 are the big new code
(see the "Gaps" list above), and slice 6 must land before 5 leaves containers running.

## 3. Cut-over and rollback

**Cut over only when** the preview has run a full merge round (items 1 to 5, on a repeat run) with the old office
stopped and its PR agent not involved. The cut-over needs the owner, so it goes in a `MANUAL RUN:` issue.

1. Freeze: finish or park every in-flight worker in the old office; note open PRs and queued tasks.
2. Export the queue and roster (`workers.json`, queue file) and import them into the DO.
3. Deploy the production stage with `DEPLOYS=1 AGENTS=1 CHECKS=1` (owner, varlock).
4. Point the board's webhooks at codeSplitter; check the board against `gh pr list`.
5. Run one real merge round, watching `gh pr checks` and the board together.
6. Leave the old binary stopped, not deleted, for a week.

**Rollback** (any step fails, or the first week goes badly):

1. Send every hosted worker home and turn the hosted queue off.
2. Start the old binary (`bun run office:mama`). Its `.agent-office/*.json` were never touched, so its queue and roster
   are as frozen in step 1; re-add tasks created hosted-side from the export.
3. Repoint the webhooks. Open PRs live on GitHub either way, so none are lost.
4. File an issue with what broke before trying again.

Delete the old build scripts only after a week with no rollback.
