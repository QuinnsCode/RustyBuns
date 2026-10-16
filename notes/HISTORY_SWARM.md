# History swarm (plan)

A swarm of agents that read this repo's own history in parallel and report what it shows. The first read is
[jams.md](../apps/codesplitter/docs/jams.md): one script (`scripts/jam-report.ts`) counted jammed PRs. A swarm does
what one script can't: judge each PR or commit, not just count it.

Status: plan only. Nothing is built. No worker was on this when the plan was started (Oct 15, 2026).

## Questions worth asking of 1100+ commits and 900+ merged PRs

1. Why did a PR jam? A reading of its diff and threads: a real clash, a renumbered migration, or churn (the script
   only matches titles, so its counts are a floor).
2. Which jams would Mervin's line-id merge or wave plan have cleared? Replay with `scripts/mervin-score.ts` and
   `scripts/merge-plan.ts`; the agent explains the misses.
3. Which red CI runs were the PR's own, main's, or flaky (Ester's four owners)? Run logs expire, so only recent ones.
4. What got built twice? Helpers or features that landed more than once ("Cut before you add" repeats).

## Shape

- A **splitter** cuts history into slices (a PR range or a day each) and writes one task file per slice.
- **Readers**, one per slice, read-only (`gh`, `git log`, `git show`). Each writes one JSON row per PR into
  `notes/history-swarm/<slice>.json`: `{ pr, jammed, why, file, mervinWouldClear }`. No GitHub mutations (agents on
  this repo are read-only there).
- A **merger** concatenates rows, reports disagreements with `jam-report.ts`, and updates the tables in `jams.md`.
- Cap: 8 readers, cheapest model, 100 PRs per slice, so cost is counted before it runs.

## Steps

1. Slice and row schema, plus a test of the splitter on a fixture history (the only unit worth writing).
2. Run one slice by hand with one reader; check its rows against `jam-report.ts` for the same PRs.
3. Run the full swarm once; merge; refresh `jams.md` with the judged numbers.
4. File each finding as an issue (Mervin gaps to #1526, engine gaps to codeSplitter issues).

## Open

- Does the owner want this as a script under `scripts/` or as a codeSplitter feature (the swarm reading a repo's
  history inside the product)? Plan assumes the script.
- Budget: cheapest model, but the owner should approve a fan-out count before step 3.

## First run (Oct 15, 2026)

Four haiku readers, 250 merged PRs each (#80 to #1824), keyword rule on commit headlines. Rows: `notes/history-swarm/`.

- 122 of 1000 PRs jammed (12%). Slices: 34, 45, 20, 23. This is lower than the 25% in jams.md because the
  squash-merged history drops most branch commit titles; treat both as floors.
- Why: conflict 74, other 21, renumber 16, churn 11.
- Files: `client.html` 39 (under the old `codesplitters` path and the new one), `apps/codesplitter/README.md` 12,
  root `README.md` 4. Same hot spots as jams.md.
- Known noise: PRs 126, 256 and 262 matched "conflict" in feature titles. The `why` buckets differ by reader, and
  "file" is the most-churned file per PR, not a measured clash. No Mervin replay or judging of diffs yet (steps 2 and 4).
- `jams.md` is not updated: these numbers are too rough to replace its table.
