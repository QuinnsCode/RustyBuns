# Token ledger, Oct 2 – Oct 28, 2026

How this repo ships a lot of code on one Claude plan. Written up for a friend; the page with charts is
[the RustyBuns Token Ledger artifact](https://claude.ai/artifact/VkpLHse6MA2UeHtJEYbnXs) (private, owner shares it;
the Oct 2 – Oct 27 version is [this one](https://claude.ai/artifact/RTuQ7a92Kg73euWn1Gcaea)).

## Headline numbers

| | |
|---|---|
| Sessions (main + subagents, this Mac) | 1,909 (1,759 in RustyBuns worktrees) |
| Input tokens (uncached + cache read + cache write) | 8.67B |
| Read from cache | 8.48B (97.8%) |
| Cache writes / uncached input / output | 190.4M / 222k / 44.6M |
| Weighted spend vs. no caching (read 0.1, write 1.25, output 5) | about 15% (−85%) |
| Compactions | 38 (36 automatic), 2.0% of sessions |
| Peak context per session | median 87k, p90 182k, p99 383k |
| Model turns | Opus 5.5 66.1%, Sonnet 5.5 30.0%, Fable 5.1 3.7%, Haiku 0.1% |
| Commits on main | 1,558 (+390,834 / −39,414 lines) |
| Merged PR size (last 1,000) | median 76 lines, p90 414 |
| Repo | 441 test files |

## Levers

- **Model per task.** Each task is sized as Fable, Opus or Sonnet work, almost all at medium effort; lookups go to subagents at lower effort.
- **One shared prefix.** One `AGENTS.md`, one set of CLIs, one test/PR path for every app, so every agent's long prompt prefix is the same and sits in cache. Cache writes are 2.2% of input but 18% of weighted spend; keeping the prefix stable keeps them small.
- **CLI first and code mode.** 59,424 shell calls and 749 on-demand tool loads in the transcripts. codeSplitter's code mode cuts tool listing from ~30,200 to ~1,050 tokens and a 20-TODO job from ~36,800 to ~1,200 (`apps/codesplitter/README.md`); locally it was called only twice, so the shell does that job here.
- **Mervin** (no model): git/git replay settled 43% of 400 conflicted merges exactly, 6% close, 39% cards, 13% wrong; flagged 84% of express's fights at 98% precision (`apps/codesplitter/docs/mervin.md`). 23% of this repo's PRs jammed, costing ~136 hours and ~360 commits; Mervin's share of that is an estimate (`docs/mervin-and-ester.md`).
- **Ester** (no model): triages red checks so only blocking failures stop a merge. ~100 hours sat between first red runs and merges; her share is not measured.
- **Dexter** (no model): names the biggest tool results in the last 24h, proposes trims to `CLAUDE.md`, `AGENTS.md`, memory and skills as a diff, and asks sessions for a handoff at 250k context (warning at 150k).

## Method

Every assistant turn's `usage` in `~/.claude/projects/**/*.jsonl` (1,923 files), deduplicated by message and request id,
`<synthetic>` turns dropped, tool calls counted once per tool-use id; compactions are `compact_boundary` system lines. Transcripts before Oct 2 were already pruned.
Commits and lines from `git log origin/main --since=2026-10-02 --shortstat`. Weights are relative, not dollars. Plan usage
percentages are not in the transcripts.
