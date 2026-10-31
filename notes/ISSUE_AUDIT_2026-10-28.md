# Open-issue audit, 2026-10-28

> **Snapshot of 2026-10-28, not current.** Since then: `deploy-runner.ts` has a plan-only try-out (`POST /try`), Alchemy is on beta.84 (#2574 replaced draft PR #2246), #2237 is unblocked, and `apps/mythic-masters` is the creature arena. Check each issue before acting on a row (#2956).

Read-only pass over 31 open issues for the Issues agent: code on `origin/main`, merged PRs (`gh pr list --search`), `git log`. Nothing was closed or commented on. **Confidence is "checked the code or PR", not "ran it"**: where a verdict rests on a doc line or a missing file, the row says so. Verdicts: DONE, PARTLY, BLOCKED, STILL OPEN.

| # | Verdict | Evidence and what is left |
|---|---|---|
| 1141 | PARTLY | `shadow.ts --check` shipped (#1142); the triage run over the ~139 git-only PRs never completed (a first run was stopped, Keychain popups fixed in #1152). Left: [ ] run `--check` over the PR list on the builder Mac, [ ] one fixture in `test/conflicts.test.ts` per `fail`. |
| 1365 | PARTLY | `scripts/smoke-adopt.ts` merged (#1379). Left: [ ] run it on the owner's disposable Cloudflare account, [ ] sweep leftovers. Owner's last comment says the tech is there now, so this is a MANUAL RUN candidate (needs their account). |
| 1400 | STILL OPEN | #1404 (hosted Build/Plan) was closed unmerged; `deploy-runner.ts` has no plan-only run and the client still says "Runs on the desktop app". Next: plan-only run in `deploy-runner.ts` (clone, install, `rustybuns infra --json`, `plan --offline`), enable the buttons on hosted. `protect` for Workers/DOs/containers also still absent. |
| 1428 | DONE | #1639 drops codex and pi from hosted runs, #1436 scopes `GH_TOKEN` to codex on owner-started runs, #1430 lockdown, #1445 security model tests. Not checked: whether claude's read-outside-cwd default is pinned (last bullet of the issue). Close unless the Issues agent wants that one line confirmed. |
| 1494 | DONE | #1497 "folder mirrors: bring workspace dependencies from outside the folder". |
| 1521 | PARTLY | Only the board-side pieces landed (#1531 and earlier Mervin board work; `board.ts`, `board-routes.ts`). No per-round consented record, tier track records, or repo-page hit rate found. Left: [ ] record per round with consent, [ ] feed tier track records back, [ ] repo-page hit rate, [ ] each "wrong" becomes a `conflicts.test.ts` fixture. |
| 1771 | BLOCKED | On the owner (live GitHub, a real 30-PR board). `docs/mervin.md:268` still says nobody has timed a 30-PR or `--go` round (#1776 only measured a 5-PR plan). The first real `--go` prints `queued N in X s`; paste that number into the README. |
| 1794 | PARTLY | #1800 added a chapter and per-chapter `tour-smoke`; `scripts/tour-smoke.ts` has 7 chapters against 76 files in `src/features/`. Left: [ ] a scene plus three-ways smoke for the other ~69 features. Fan out in batches of ~8 features. |
| 1831 | PARTLY | `scripts/history-swarm.ts` exists and `notes/history-swarm/` holds slice files, but `apps/codesplitter/docs/jams.md` tables are not refreshed and I found no merge of judged rows. Left: [ ] one reader on one slice and `merge` vs `jam-report.ts`, [ ] owner approves fan-out count (cap 8), [ ] full run, refresh `jams.md`, [ ] file findings as issues. Slices existing hints step 1 may have been started; check the issue's newest state before spawning. |
| 1852 | PARTLY | #1859 added the big who-got-home count (item 4 of the list). Left: [ ] owner reviews story copy, [ ] owner call on autoplay on landing page, [ ] light theme / 360 px / reduced motion check, [ ] real-app check of the landing section, [ ] stage journey test. The first two are the owner's. |
| 1732 | PARTLY | #1755 flags arm64 box deploys at queue time. Left: [ ] egress gate still tunnels CONNECT undecrypted (`egress-gate.ts:5`), no per-session CA, [ ] opt-in `ci.Dockerfile` test, [ ] icon chip / split Run button / empty state (not looked for in `client.html`), [ ] `IMAGE_CAPS` still in `needs.ts:7`, not `rustybuns.config.ts`. |
| 1572 | BLOCKED | On the office's author (upstream, "show them, don't PR"). #1628 lists the gaps in `apps/agent-office/README.md:180`. Nothing more an agent can do; owner decides when to show the upstream. |
| 1477 | PARTLY | #1478 shipped `src/dep-docs.ts` (detection across npm, Cargo, pyproject, go.mod, Gemfile; docs on major bumps; table merges) and `test/dep-docs.test.ts`. Left from "Done when": [ ] sandboxed install-and-build on a replayed merge that tears down, [ ] cost cap, [ ] rerun express, rails, git/git against the `mervin.md` table. I did not run the tests. |
| 1343 | PARTLY | #1359 plus later work: 19 hair styles (locs, braids, curls, topknot...), 15 hats (rubber duck, propeller shipped). Missing from the issue's list: trucker cap, helm, pager, tinfoil, sorting hat, git-blame hard hat, glasses/accessories coverage not checked. Left: a few more hats and accessories, each one list entry plus the 2D and 3D drawing. Low value; fine to close as "scaled enough" if the owner agrees. |
| 1052 | STILL OPEN | Only the plan exists (`notes/game-ideas/1-creature-arena.md`, #1054). No `apps/*` for it. Next: owner picks whether to build; a worker could scaffold `apps/wildclash` with one arena and two creatures. Not for fan-out without the owner's say. |
| 897 | STILL OPEN | No `bwrap` or Landlock code anywhere in `packages/`, `apps/*/src` or `scripts/`. Next: `bwrap` wrapper in the `run desktop --sandbox` path mirroring the Seatbelt deny-list, tested in a Linux container. Low priority (CI is on Linux, owner's Mac is the target). |
| 840 | BLOCKED | On #825 (owner's live data move). `deploy-keys.ts:85` still opens both `codesplitter` and `codesplitters` AAD. The issue's own comment says one agent does #840 and #823 together after #825. |
| 823 | STILL OPEN | `scripts/move-artifacts.ts` and `/api/admin/artifacts/verify` do not exist; `ARTIFACTS` is still bound to `codesplitters`. #1654 merged without them (per the 2026-10 closed-issue audit comment). Next: add the mirror-clone copy (swap `import` for a mirror push in `copyPage`) and the verify route. Cutover is the owner's after #825. Do together with #840. |
| 740 | PARTLY | Both children (#722, #276) are CLOSED. The domain-move PR (route, `BETTER_AUTH_URL`, OAuth callbacks) has not happened; `rustybuns.config.ts` has no custom route. Blocked on the owner naming a domain; then a worker can open that PR. |
| 318 | PARTLY | `fit.ts` `SUPPORTED` now has react-router, sveltekit, nuxt, next (OpenNext only), solidstart, qwik (#1688, #1691, #2452 nine framework examples; `apps/*-example` exist). Left: [ ] Angular, [ ] Gatsby, [ ] webpack/#849 (still `TRACKED`), [ ] vinext route for Next.js, [ ] SvelteKit desktop sample run recorded, [ ] React Router `cloudflareDevProxy` and Remix v2, [ ] tick the boxes in the issue body. Several boxes can be ticked from #2452 now. |
| 2327 | PARTLY | `apps/elysia-conduit` and `elysia-example` exist (#2280), `fit.ts` knows elysia as a fetch server. Not checked in this pass: RWSDK Queues/Cron/Email twins, an Elysia row in `FRAMEWORK_COVERAGE`, five-primitives page wording. Wasp scope decision is the owner's. |
| 2328 | STILL OPEN | No PR references it. Next: `rustybuns test` on Alchemy's harness against the preview stages; read `@alchemy.run/git` next to the merge code. Price first (`costs.ts`). |
| 2329 | PARTLY | The builder Mac exists (#2414, `BUILDER_HOST` set to the 64 GB Mac). Left: the Hetzner CCX33 week-long trial (about EUR 9). That spends money: ask the owner. |
| 2326 | PARTLY | Umbrella. #2452 landed nine examples. Children #2327, #2328, #2329 are open; keep open until they close. |
| 2346 | BLOCKED | On tscircuit moving to zod 4 (the root `package.json` still excludes `apps/tscircuit-desktop`). Check `npm view tscircuit` dependencies occasionally; nothing to do until then. |
| 2285 | STILL OPEN (back burner) | Six sections, none touched, owner marked it back burner. Section 1 (Cloudflare version) is an owner decision; 6 is a MANUAL RUN. No fan-out. |
| 2241 | STILL OPEN, unblocked | The 3-day gate cleared 2026-10-27, which is yesterday. Draft PR #2246 is open ("WIP"), last touched 2026-10-25; main is still on beta.77 and effect rc.112. Next: rebase #2246 on main, `bun install --frozen-lockfile`, typecheck, plan on codeSplitter's stack, then re-apply the effect 4.0.5 bump (#2220/#2242). |
| 2237 | STILL OPEN | No `postgresState` anywhere. Depends on #2241. The cutover needs the owner's database URL secret; a worker can do everything up to that. |
| 2235 | PARTLY | Same work as #2241: in PR #2246 (draft), not merged. Close both with that PR. |
| 2215 | PARTLY | Duplicate of #2235/#2241 (same beta.84 bump, with `alchemy provider` command changes). Close as a duplicate once #2246 lands, or now. |
| 2216 | BLOCKED | Waiting on Bun AOT shipping; no code to check. Revisit on the next Bun release after our 1.4.3 pin. |

## Counts

DONE 2 (#1428, #1494). PARTLY 16. STILL OPEN 8 (#1400, #1052, #897, #823, #2328, #2241, #2237, #2285). BLOCKED 5 (#1771, #1572, #840, #2346, #2216). Total 31.

## Fan out right now (ready prompt lines)

1. `#2241 / #2235 / #2215: Rebase draft PR #2246 (Alchemy beta.84, provider packages, DO_NOT_TRACK) on main now the release gate cleared; install, typecheck, plan codeSplitter's stack and confirm nothing is replaced; also re-apply effect 4.0.5. Base the PR on main.`
2. `#1400: Teach apps/codesplitter/src/deploy-runner.ts a plan-only run (clone, install, rustybuns infra --json, plan --offline) so the Ship pop-out's Build and Plan buttons work on the hosted site; one journey test.`
3. `#823 + #840 together: add scripts/move-artifacts.ts and POST /api/admin/artifacts/verify (swap Artifacts import for a mirror push in copyPage), then remove the codesplitters AAD in deploy-keys.ts; stop before any cutover and file a MANUAL RUN: issue for the owner.`
4. `#1794: Add tour scenes and three-ways smoke checks for the next 8 features in apps/codesplitter/src/features (order.txt), one PR per batch.`
5. `#318: Tick the boxes #2452 already covered, then take Angular and Gatsby (or name them out of scope) and the vinext soft try for Next.js; one PR on main.`
6. `#1521: Record per-round Mervin outcomes with consent (tier per file, verdicts, CI time) in board.ts and show the hit rate on the repo page; every wrong becomes a conflicts.test.ts fixture.`
7. `#1732: Move IMAGE_CAPS out of apps/codesplitter/src/needs.ts into rustybuns.config.ts and add the opt-in ci.Dockerfile egress test; leave the per-session CA for a later issue.`

Not for a worker without the owner: #1365 (their Cloudflare account), #1771 (live GitHub), #1831 fan-out count, #2329 (rental spend), #1052 (build decision), #740 (domain).
