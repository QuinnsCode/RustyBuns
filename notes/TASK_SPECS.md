# What a hire task needs: the office's own numbers

Every worker is hired with a task. The owner steers it when it drifts, and its PR merges or doesn't.
`bun scripts/task-specs.ts` reads those runs from the session transcripts and sets each task's detail beside what
happened. The rules in AGENTS.md ("Hiring a worker") and the one-time nudge in `.claude/hooks/thin-hire.ts` come
from it.

## How a run is read

- **Task:** the first prompt the worker was typed. When it says "issue #N", the issue body and the comments that
  were already on it when the worker started are part of the task too.
- **Level:** the script sorts each task by its counts (`level()` in the script):
  - **Thread:** two or more voices, such as earlier issue comments or relayed messages.
  - **Agent-ready:** names a file to start in, says how to check the work, and runs to 120 words or more.
  - **Decided:** 50 words or more, or three or more must and must-not words.
  - **Vague:** anything else.
- **Outcome:** whether a PR opened from the worker's branch, and whether it merged.
- **Steers:** the owner's own later prompts of more than six words. Shorter ones ("done?") are pings, not steers.
  Notices, hook text and messages from other agents aren't counted.
- **Spend:** tokens at API price ratios (Dexter's `units`), and wall time from the first prompt to the last line.

## What it found (2026-11-23, last 30 days, 1,718 worker sessions)

| Level | Runs | PR opened | Merged | No steer | Steers per run | Median minutes | Spend per merge |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vague | 94 | 61% | 60% | 45% | 2.1 | 36 | 1.41M |
| decided | 709 | 78% | 77% | 71% | 0.7 | 32 | 1.51M |
| agent-ready | 842 | 82% | 80% | 80% | 0.4 | 30 | 1.43M |
| thread | 73 | 81% | 81% | 77% | 2.0 | 33 | 1.55M |

- **Most of the gain is from vague to decided.** Writing down what the task must and must not do takes merges from
  60% to 77%, and the owner's steers from 2.1 per run to 0.7.
- **Saying how to check the work** doesn't change the merge rate (78% either way), but steers fall from 1.4 per run
  to 0.5.
- **Hiring from an issue** costs 1.27M per merged PR, against 1.67M for a task typed straight in, with 0.6 steers per
  run instead of 0.9.
- **Length doesn't hurt.** Tasks over 1,000 words merged 88% of the time.
- **Long sessions cost more.** Runs of 15 to 60 minutes merged 87% at 1.06M per merge. Runs past 12 hours merged 64%
  at 4.6M. Runs steered ten or more times merged 53%.

## What this can't say

- Nobody chose the levels at random. Big jobs get long specs and long sessions, so each comparison mixes the habit
  with the size of the job.
- The level comes from word counts and patterns. No person read each task to check it.
- One worker can take a second task in the same session, and that second task counts as a steer.
- Merged doesn't mean correct. The owner squash-merges once CI is green.
- Transcripts last about 30 days, so a run only covers the last month.

`--out rows.json` writes one row per session with only counts and outcomes: no prompt text, names, branches or paths.
