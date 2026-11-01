# Closed-issue audit, 2026-10-14

> **Snapshot, state at 2026-10-31:** several items are fixed since (`tv-limits.ts` is wired in `client.html`; `cuts.ts` uses `spawnAs`), and the "reopen or file" list's issue states changed (#823, #1526, #318 open; #1693, #1681, #1554 closed). Check each issue before acting (#2956).

The last 100 closed issues, checked against origin/main at 90a0ebb6: was the work done, and did an agent close it
on poisoned context (a stale premise, a PR body claiming what its diff doesn't do, the wrong issue number)?
Each closing PR's diff was read against the issue's asks and against main now.

| Closed by | Count | Result |
|---|---|---|
| A merged PR | 75 | 46 done, 28 partial, 1 wrong, 0 regressed |
| Folded into #609 (MANUAL RUN, not planned) | 24 | all 24 listed in #609 section 9, none lost |
| By hand | 1 | #1633: its fix #1634 merged |

## The pattern

Nothing that landed was later lost on main. What went wrong is mostly bookkeeping: **a PR lists its leftovers as
"follow-ups" or "left on #N", then says `Closes #N`, and the leftovers have no home.** That happened on about 20 of
the 28 partials. Agents in the office run side by side, so four PRs (#1621, #1624, #1630, #1622) also built one
feature (Mervin learning) on three different schemas and none of them joined up.

**Poisoned context (1):** #823. PR #1654's body says it adds `scripts/move-artifacts.ts` and
`POST /api/admin/artifacts/verify`, and that Artifacts' `import` returns 401 on private repos. The merged diff has
neither file, and `copyPage` (`src/artifact-move.ts`) uses that same `import`. Its test fakes `import`, so nothing
checks the real path. `ARTIFACTS` is still bound to `codesplitters`.

**Closed too early:** #1526 (umbrella) closed by #1531, whose body lists six of seven children as not done; #1521 is
still open. #318 (framework tracker) closed by a SvelteKit-only PR, while `TRACKED` in `packages/cli/src/glue/fit.ts`
and FRAMEWORKS.md still point next, nuxt, solidstart, qwik, angular, gatsby and react-router at it.

## Fixed in this PR

- #1569: a private line copied into *another* file the same agent run edits now counts as a leak (`src/agent-run.ts`
  checks every file's private lines in every file; `test/leaks.test.ts`).
- #1593: `get_board?brief=0` returned the brief answer (`src/board-routes.ts`); the #1593 paragraph in
  `docs/mervin.md` was pasted mid-sentence.
- #1509 / #1511: `docs/mervin.md` said both "delete-my-data is built" and "not built yet"; it now says what is joined
  and what isn't.
- #1448: the last five inline repo lookups in `checks.ts` and `mirror.ts` use `repoRow`; AGENTS.md drops the
  "about 55 copies" line.
- #1676: the README's Repo health line says how dev dependencies are weighted (the PR said it did; its diff didn't).
- #846: `generate`'s hint said `rustybuns adopt` replaces `wrangler.json`; it doesn't, and wrangler reads `.json`
  before `.jsonc`. The hint now says to delete it first.
- From #1512's diff: `apps/codesplitter/.wrangler/cache/` (the owner's account id and email) was tracked; untracked,
  and `.wrangler/` is ignored.
- Stale open issues: #1544 (#1541 merged green) and #1483 (#1432 merged as `20261013050000_protect_main.sql`).

## Still open, to file (drafts)

Each line is one issue. Agents in this session were not allowed to open or reopen issues, so the owner files them or
says to.

1. **Reopen #823** (Artifacts namespace move): land the git-mirror copy and the verify route the PR described, or
   replace `import` in `copyPage` with a mirror push; then a MANUAL RUN item in #609 for the move itself.
2. **Reopen #1526**, or keep it closed and file 3-5 below and link them from it.
3. **Mervin learning, join the three paths** (#1509, #1510, #1511): pick D1 or the Pipeline, bind or delete the
   other (`MERVIN_EVENTS` is bound nowhere), rewrite `src/mervin-learn.ts`'s queries against it and call them from the
   merge plan, and set `checks_passed` from the real check.
4. **Mervin settles, not names** (#1523): apply `settle()`'s `renumber` in `writeTree`; `bun install` on the staged
   tree and keep its `bun.lock`; add the `shares.ts` and `deploy.ts` cards to the corpus.
5. **Mervin `--go` and re-lands** (#1542 items 2, 4, 7; #1525): poll `mergeable` after each merge, rerun failed jobs
   once main's fix lands, link a re-land to its original PR, merge disjoint PRs in parallel and time a 30-PR board.
6. **Watch Mervin live** (#1516): the live diff view, the live feed with a real pause of the next wave's
   `gh pr merge --auto`, and the add/build/deploy lanes.
7. **Framework tracker** (#318): reopen it, or file a new tracker and repoint `TRACKED` and FRAMEWORKS.md; the
   Next.js/vinext soft try and plan the owner asked for; the SvelteKit desktop sample run.
8. **Containers follow-up 3** (#1693, from #818 Parts 3 and 4): the egress gate decrypting with the per-session CA
   instead of a CONNECT tunnel, an opt-in test against the real `ci.Dockerfile`, the icon chip, the split Run button,
   the empty state, flagging an arm64 box deploy at queue time, and `IMAGE_CAPS` into `rustybuns.config.ts`.
9. **Tests, the rest of #1681**: per-test timings from one CI run; journeys for hook, token and conflict; delete the
   per-file tests they cover; the same pass on `packages/cli`, `packages/shell-bun` and `apps/agent-office`.
10. **Ester records** (#1677): keep the per-package rows across runs (JSONL or a table) and rank over them.
11. **Dexter trims** (#1591): skill descriptions and worker prompts, not only CLAUDE.md, AGENTS.md and MEMORY.md.
12. **Rollback fix task and TV limits** (#1562): open the fix task on a fresh branch from main; wire
    `src/tv-limits.ts` (imported only by its test) into the TV view.
13. **Mirror box** (#1555): a pull-only choice in `wireMirrorTurn`, hide Push upstream on pull-only mirrors, the
    "Mirrored in step" chip switches tabs, upstream PR branches sync, and the merge page shows Mervin's waves.
14. **Profile pages, the rest** (#1586): in-page WebMCP rewrite/preview/revert, binary assets in R2, a "make my page" button.
15. **Code page, the rest** (#1679): the Dependencies panel's sentences behind `note()`, the phone view's **i**
    (`.sec-i.inl` has no click handler on `#/m/...`), the browser pass and the `slice` toast.
16. **Cuts run as the sandbox user** (#1570): `src/cuts.ts` spawns `bun test` with `checkEnv` but not `spawnAs`.
17. **Office cards** (#1573): flag control characters in every field the Allow/Deny card shows, not only the
    prompt; the ASK_FIRST default as an owner decision.
18. **Ship from a branch** (#209): `rustybuns init` on a branch as `agent-rustybuns`, committed for review, with the
    walk-through the owner asked for (the PR only added a button opening Ship).
19. **Port tries** (#849): run the guided port on AdGuard Home, CyberChef and jellyfin-web.
20. **MANUAL RUN additions to #609**: run the #1593 three-way board measurement with Dexter; measure
    `health()` peak memory on express, vite and react (#1675); docs-site environment, secrets and domain (#831);
    check `codesplitters.notryanquinn.workers.dev` is gone and delete `~/.config/codesplitters/config.json` (#1554).

Also noted, not filed: `docs-site.yml` refreshes `latest/` only on a tag, never on a push to main (#831); the
`onCloudflare() && isAgentHandle` clause in `src/identity.ts` `aliasOf` can't fire (both callers run only with
accounts off, where Cloudflare already closes aliases), kept as a belt; #1678 merged on 10-14 though its issue said to
wait until after 10-21.
