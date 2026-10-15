# The Terrific Trio

Three helpers sit in the corner of the Agent Office floor. None of them calls a model. Each takes one job off your agents, and every token they don't spend goes to features.

|  | Job | Costs tokens? |
|---|---|---|
| **Mervin** | Merges. Reads the open PR board, settles conflicts, orders the waves. | No |
| **Ester** | Tests. Sorts every failing test by who owns it. | No |
| **Dexter** | Trims. Finds where the tokens go and proposes the cuts. | No |

They are deterministic scripts, and we think of them as more than that. Each has a name, a badge, a track record and a way of getting better, and the tour introduces them that way.

## Smartest for the least money

Put the work on three corners.

1. **Free.** Rules and replay. Mervin's merge logic, Ester's triage, Dexter's trims. A question answered once is answered forever.
2. **Cheap.** A small model for the easy leftovers.
3. **Expensive.** The strongest model, kept for what nothing cheaper can settle.

Every hard problem is paid for once at the top and then costs nothing. That is token banking: each conflict Mervin settles, each rerun Ester skips and each oversized result Dexter flags is a token your weekly limit keeps for features.

## Mervin: the merger

Mervin turns a pile of open PRs into waves that land. He stages each PR onto main in a sandbox, files every changed file as certain, agree, settled, differ or ask, and holds a PR when its CI is red or it sits behind one that is. When two branches did fight, he settles the conflicted files with a line-id merge, and asks when he is not sure.

- Replayed over git/git's history, he settled **49%** of the files git gave up on: 43% exactly as the person committed, 6% to the same lines in another order. 39% he handed back as cards, and 13% came out as other text (the number to drive to zero).
- He learns. On express, one new rule (merge `package.json` by key) took the unsolved files from 162 to 147. Each answered card can become a rule, so the share he settles climbs.
- Every round is recorded (the PR list, main's sha, the board and the verdicts), so a bad round can be replayed on exactly the same input.

Details: [codeSplitter's Mervin guide](../codesplitter/docs/mervin.md).

## Ester: the tester

When the merged tree goes red, Ester says whose fault it is. **main** (fails on main too: ignore), **flaky** (passed on a rerun), **own** (a PR with red CI of its own touches that app: it fixes it first), **wait** (that PR's CI hasn't finished) or **blocks** (only the merge breaks it, with the PRs to hold back named). Only `blocks` stops the round. Nobody reads a log to learn that.

## Dexter: the trimmer

Dexter reads Claude Code's own transcripts and adds up the tokens: input, output, cache reads and writes, by day. He names the tools whose results sat biggest in the context, since a result is paid for again on every later turn, with a plain tip for each. He also proposes trims to the text every session pays for (`CLAUDE.md`, `AGENTS.md`, the memory index) as a diff you approve. He never edits a file.

Run `DEXTER_HOURS=168 bun apps/agent-office/ester/dexter.ts` for the week: spend per day, what each job costs when an agent does it by hand, and what the helpers bank.

## What it adds up to

A measured week on this repo (1,019 sessions, 40,870 turns):

- **715M units spent**, 65% of it cache reads.
- **14% went to merge fights**, 4% to board reads, test output and oversized results, 82% to the work.
- With a fixed weekly limit, the trio buys about **11% more features a week** today. Mervin's share grows as he learns, to about 15% in ten weeks at one new rule a week.
- Fight share of spend fell from 27% on 11 Oct to 7% on 14 Oct, the days the trio landed.

Read those numbers as early. The trio has been live for days, not months, the 49% is a replay on another repo's history, and the one-rule-a-week pace is an assumption. The bank is just opened. The point of it is that the balance only goes up.

## Meet them

Click a badge in the corner of the page: a skull for Ester, a merge icon for Mervin, scissors for Dexter. Each card shows the tail of its run with a ticking clock, and a dot on the badge says green or red. They run from `POST /__rb/helpers/<ester, mervin or dexter>`, one run of each at a time. More in the [Agent Office README](README.md).
