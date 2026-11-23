# Task detail and how worker runs go: field data

Jeff Linwood ran a controlled test of how much detail an issue needs before a coding agent builds it right
([Instant Rocket experiment 002](https://instantrocket.com/experiments/002-issue-specification/)). It used one task,
four description levels and 80 runs, scored by hidden tests. The office already writes down the same thing for real
work: every worker is hired with a task, the owner steers it when it goes wrong, and a PR merges or doesn't.
`bun scripts/task-specs.ts` reads those runs and puts them in his four levels.

## How a run is read

- **Task:** the first prompt the worker was typed. When it says "issue #N", the issue body and the comments that
  were already on it when the worker started are part of the task too.
- **Level:** the script sorts each task by its counts (`level()` in the script):
  - **Thread** (his D4): two or more voices, such as earlier issue comments or relayed messages.
  - **Agent-ready** (D3): names a file to start in, says how to check the work, and runs to 120 words or more.
  - **Decided** (D2): 50 words or more, or three or more must and must-not words.
  - **Vague** (D1): anything else.
- **Outcome:** whether a PR opened from the worker's branch, and whether it merged.
- **Steers:** the owner's own later prompts of more than six words. Shorter ones ("done?") are pings, not steers.
  Notices, hook text and messages from other agents aren't counted.
- **Spend:** tokens at API price ratios (Dexter's `units`), and wall time from the first prompt to the last line.

## What it found (2026-11-23, last 30 days, 1,718 worker sessions)

| Level | Runs | PR opened | Merged | No steer | Steers per run | Median minutes | Median spend | Spend per merge |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vague | 94 | 61% | 60% | 45% | 2.1 | 36 | 406k | 1.41M |
| decided | 709 | 78% | 77% | 71% | 0.7 | 32 | 620k | 1.51M |
| agent-ready | 842 | 82% | 80% | 80% | 0.4 | 30 | 749k | 1.43M |
| thread | 73 | 81% | 81% | 77% | 2.0 | 33 | 914k | 1.55M |

- Most of the gain comes from the step from vague to decided, as in his test (3/20 to 17/20 there). Here it is
  60% to 77% merged, and from 2.1 steers per run to 0.7.
- A thread merges as often as an agent-ready task, as his D4 did. It costs the most per run, though, and a few
  threads need a lot of steering: the mean is 2.0 steers per run, but the median is 0.
- What a merge costs is about the same at every level (1.4M to 1.55M). A vague run spends less, but more of its
  runs end with nothing merged, and the owner pays for the difference with steers.
- Tasks that point at an issue merge 79% of the time with 0.6 steers per run. Tasks typed straight in merge 77%
  with 0.9 steers.

## What this can't say

- Nobody chose the levels at random. Big tasks get long specs, and an agent-ready task is often a bigger job, so
  the levels differ in more than their wording.
- The level comes from word counts and patterns. No person read each task to check it.
- One worker can take a second task in the same session, and that second task counts as a steer.
- Merged doesn't mean correct. The owner squash-merges once CI is green, and no hidden tests are run here.
- Transcripts last about 30 days, so a run only covers the last month.

## Sharing it

`bun scripts/task-specs.ts --out rows.json` writes one row per session with only counts and outcomes: no prompt
text, names, branches or paths. That file can be shared once the owner says so. The transcripts themselves stay
on this Mac.
