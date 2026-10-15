# History swarm (plan)

A swarm of agents that read this repo's own history in parallel and report what it shows. The first read is
[jams.md](../apps/codesplitter/docs/jams.md): one script (`apps/codesplitter/scripts/jam-report.ts`) counted jammed PRs. A swarm does
what one script can't: judge each PR or commit, not just count it.

Status: step 1 is built: `apps/codesplitter/scripts/history-swarm.ts` (`split` writes the slice tasks, `merge` checks the
readers' rows against `jam-report.ts`), tested on a fixture in `test/history-swarm.test.ts`. No reader has run; step 3
waits for the owner to approve a fan-out count.

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
