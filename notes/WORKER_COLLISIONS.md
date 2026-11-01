# Why workers still collide, though we own Mervin, Ester and the dispatch hint (spike, 2026-11-01)

Short answer: the tools exist but run only after the collision, by hand, or only in one UI path. Nothing in the
loop a worker actually walks (`office-workers hire` -> worktree -> push -> GitHub PR -> CI) consults them.

## 1. Mervin and Ester today

- **Mervin** = `apps/codesplitter/scripts/mervin-board.ts` (board of open PRs onto main, tiers certain/agree/mervin/differ/card),
  engine `src/merge-plan.ts`, `scripts/mervin-*.ts`. It reads `gh pr list` only and merges in a local sandbox, so it
  does **not** need the repo on codeSplitter. Yes, it works on the GitHub repo as is.
- **Ester** = `scripts/ester.ts`, only runs on the board's `--check` output (install, typecheck, tests in a sandbox)
  and files each red test: main / flaky / own / wait / slow / blocks. Not run by CI or on push.
- Run read-only today against the 3 open PRs (`bun scripts/mervin-board.ts 3114 3113 3103`, 17 s):
  - #3114: 8 files, all certain.
  - #3113: 18 files, 72% certain; `minotaur.json` Mervin settles; `kelpie.glb`, `minotaur.glb` (binary, both changed) and the two `.rig.json` files are **cards** (a person must choose). Two PRs regenerating the same beast models is a real overlap.
  - #3103: 10 files, 90% certain; `apps/codesplitter/REFERENCE.md` flagged "generated: both sides merged clean, but `bun run layout` rewrites the Layout table after the merge". Its own CI is red (`test alien-disc-golf`, `apps`).
- No hook, workflow or worker prompt runs it: `.github/workflows` has typecheck/apps/docs only. The `--go` merge
  flow and merge rounds are driven by a person or the PR agent.

## 2. The dispatch hint

- Code: `apps/agent-office/codesplitter/{hint,index,server}.ts`, backend `GET /api/repos/:o/:r/dispatch-hint` (`src/branches.ts`).
- **Off by default**; enabled per browser in Settings > You > codeSplitter with a repo name, and it needs
  `codesplitter login` (or the desktop app). This machine has no `~/.config/codesplitter`, so unless the desktop app is running
  the hint would answer "nothing busy". I could not read the page's setting (it lives in the browser), so "enabled for
  this office" is **unverified, probably not**. DOGFOOD.md step 1 also needs RustyBuns mirrored on codeSplitter, pull-only; I could not confirm that either (needs a token).
- It is a **page-only card** (`queue.add` socket message intercepted in the client). `office-workers hire`, `tell_worker`, PR-agent hires and any
  shell path skip it (DOGFOOD.md says so).
- Same files in two queued tasks: it only guesses files from task text, shows a card with **Wait** (held on the office server until the other branches merge, `stillBusy`) or **Queue anyway**. Wait does serialize, but one human click per task.
  Two tasks queued *together* are not compared with each other, only with already-open *branches*, so tasks queued before any branch exists never conflict-check.
- It could block: the pieces exist (`Held`, `stillBusy`); what is missing is running the same check in the server-side hire/queue path, and a default of Wait.

## 3. Built vs not (MOVE.md, PREVIEW.md, #1384, #1385, #1412)

All four issues are CLOSED (#1384, #1385, #1412, and #2952 asking why). What exists:
- Built: the `office-preview` stage in `apps/codesplitter/rustybuns.config.ts` with a test that it never shares names with live; the runbook; the dispatch hint and mark/news dot; conflict agent (`src/conflict-agent.ts`); Mervin engine; identity.ts.
- Not built: the office Durable Object (queue/roster), the 3D client on the Worker, PTY over WebSocket, container lifetime, per-floor cost cap, auth mapping. README and MOVE.md say so themselves; #2952 is the live tracker.
- Deployed: nothing I could see. The runbook calls deploy a MANUAL RUN and there is nothing on the stage to run (no office). I did not run any rustybuns/alchemy command, so "no `office-preview` stage is deployed" rests on the docs, not on a Cloudflare query.
- So workers still run in local worktrees and merge via GitHub; the "workers edit through codeSplitter" idea that would make merges line-level has not shipped.

## 4. Smallest change that stops the collisions

Recommend, in order (do 1 and 2; 3 optional):
1. **Pre-push / pre-PR Mervin check (S, about 0.5 day).** A `scripts/preflight.ts` (or hook in the worker prompt) that runs
   `mervin-board.ts <my PR or branch>` against the other open PRs and prints any card/mervin file; worker rebases or hires-waits before opening the PR. Works on GitHub as is.
2. **Server-side queue guard (M, about 1-2 days).** Move the dispatch-hint check from the page into the office's hire/queue handler, so every path
   (`office-workers hire`, MCP, PR agent) gets it; default is warn, and with `--wait` or a config flag it holds the task until the
   busy branches merge (reuse `Held`/`stillBusy`). Include other *queued* tasks' file guesses, not just open branches.
3. **Generated files stop being conflict bait (S).** `bun run layout` output (REFERENCE.md Layout table), the README banner, lockfiles and migration numbers are
   the repeat offenders: either have CI regenerate and push or make `scripts/ci-apps.ts` fail with "run `bun run layout`", and give migrations a collision check in Mervin (it already has a `clashes` list for same-stamp migrations; use it as a CI check).
   Ester in CI is **not** worth it yet: she needs the whole board built (minutes, installs) and gives nothing to a single PR; keep her in merge rounds.

## 5. Evidence of recent collisions

- #3103 (this very PR line): REFERENCE.md Layout table that `bun run layout` regenerates; Mervin flags it today.
- #3115 "eqosys: renumber the party_seats migration to 0005": two PRs took the same migration number (migrations are in Mervin's clash list but only on a board run).
- #3104 "restore hydra's 0.03 h head-spread bound" (merged right after #3095): a test bound that one PR widened and a sibling PR's test caught after both landed.
- #3113 vs #3114 (open now): both rewrite Mythic Masters beast GLBs/rigs; binary-both-changed cards.
- CI: only 3 failing runs in the last 40 (`apps` on office/pixel-4710, byte-3932, bolt-3728), so test failures are mostly per-PR, not
  merge-main breakage. The collisions are cheap in count but the fixes are done by hand by the PR agent.
- Limits of this evidence: I looked at 100 merged titles and recent main log; a real count needs the merge-main fix commits per PR, which is what `scripts/merge-plan.ts` replays (its CASES are the 2026-10-12 ones).
