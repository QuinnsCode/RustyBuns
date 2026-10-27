# Token ledger, Oct 2 – Oct 27, 2026

How this repo ships a lot of code on one Claude plan. Written up for a friend; the page with charts is
[the RustyBuns Token Ledger artifact](https://claude.ai/artifact/6gS6JHrwhBSX9EnMydh3YN) (private, owner shares it).

## Headline numbers

| | |
|---|---|
| Sessions (main + subagents, this Mac) | 1,687 (1,538 in RustyBuns worktrees) |
| Input tokens (uncached + cache read + cache write) | 8.27B |
| Read from cache | 8.09B (97.8%) |
| Cache writes / uncached input / output | 180.9M / 191k / 42.7M |
| Weighted spend vs. no caching (read 0.1, write 1.25, output 5) | about 15% (−85%) |
| Compactions | 36 (34 automatic), 2.1% of sessions |
| Peak context per session | median 86k, p90 183k, p99 399k |
| Model turns | Opus 5.5 68.2%, Sonnet 5.5 28.9%, Fable 5.1 2.7%, Haiku 0.1% |
| Commits on main | 1,490 (+378,559 / −37,208 lines) |
| Merged PR size (last 1,000) | median 81 lines, p90 465 |
| Repo | ~231k lines of code, 2,539 files, 33 apps, 10 packages, 419 test files |

## Levers

- **Model per task.** Each task is sized as Fable, Opus or Sonnet work, almost all at medium effort; lookups go to subagents at lower effort.
- **One shared prefix.** One `AGENTS.md`, one set of CLIs, one test/PR path for every app, so every agent's long prompt prefix is the same and sits in cache. Cache writes are 2.2% of input but 18% of weighted spend; keeping the prefix stable keeps them small.
- **CLI first and code mode.** 62,749 shell calls and 774 on-demand tool loads in the transcripts. codeSplitter's code mode cuts tool listing from ~28,000 to ~950 tokens and a 20-TODO job from ~34,600 to ~1,100 (`apps/codesplitter/README.md`); locally it was called only twice, so the shell does that job here.
- **Mervin** (no model): git/git replay settled 43% of 400 conflicted merges exactly, 6% close, 39% cards, 13% wrong; flagged 84% of express's fights at 98% precision (`apps/codesplitter/docs/mervin.md`). 23% of this repo's PRs jammed, costing ~136 hours and ~360 commits; Mervin's share of that is an estimate (`docs/mervin-and-ester.md`).
- **Ester** (no model): triages red checks so only blocking failures stop a merge. ~100 hours sat between first red runs and merges; her share is not measured.
- **Dexter** (no model): names the biggest tool results in the last 24h, proposes trims to `CLAUDE.md`, `AGENTS.md`, memory and skills as a diff, and asks sessions for a handoff at 250k context (warning at 150k).

## Method

Every assistant turn's `usage` in `~/.claude/projects/**/*.jsonl` (1,850 files), deduplicated by message and request id,
`<synthetic>` turns dropped; compactions are `compact_boundary` system lines. Transcripts before Oct 2 were already pruned.
Commits and lines from `git log origin/main --since=2026-10-02 --shortstat`. Weights are relative, not dollars. Plan usage
percentages are not in the transcripts.
