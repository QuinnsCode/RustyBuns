# Moving Agent Office into codeSplitter

Plan for [#1384](https://github.com/QuinnsCode/RustyBuns/issues/1384): the office (workers, 📋 queue, 🔀 PR board)
becomes a [codeSplitter](../codesplitter) feature instead of the separate Bun binary in this folder. This page is
steps 1 and 2 of the issue (what the preview is, what has to move) plus the cut-over and rollback of step 3.
Nothing here is built yet (#1384 was closed without it; the open tracker is [#2952](https://github.com/QuinnsCode/RustyBuns/issues/2952)), and the live office keeps running untouched until the cut-over.

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
