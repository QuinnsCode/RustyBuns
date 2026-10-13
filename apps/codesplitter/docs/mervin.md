# Mervin

Mervin is codeSplitter's merge engine: the line-id merge (`src/lines.ts`), the resolver levels and the
merge plan (`src/merge-plan.ts`) that puts clashing PRs in waves. It swerves out of the way of merge conflicts.

## The goal: 80% of fights seen coming

A PR "fights" when git's merge of it onto main conflicts. Mervin's goal is to flag **80% of the PRs that
will fight** while they are still open, so they can be ordered into waves or have the overlap settled early
instead of two agents finding out at merge time. Precision counts too: a flag that never fights is wasted
waiting.

## The scorecard

```sh
bun scripts/mervin-score.ts [repo ...] [--limit 200] [--json]
```

For each real merge commit of a branch into the mainline, the truth is git's merge of the two parents. The
predictors see only the branch's midpoint commit and the mainline as of that commit's date, then report
recall (fights flagged ahead) and precision (flags that fought) for two predictors, `overlap` (both sides
touched a file) and `clash` (git's merge of the midpoints already conflicts). A line-id predictor and the
Mervin plan go next to them once there is a corpus to hold them to.

Needs repos with real merge commits. This repo squash-merges, so it scores nothing; use its replay
(`scripts/merge-plan.ts`) for its own history and the scorecard for pulled-in repos.

## Corpus to pull in

Busy repos that keep real merge commits, cloned in full (not shallow) to a scratch directory, scored with the
command above. Pick by merge-commit rate and by language mix. Candidates to check: Git itself, Linux
subsystem trees, Rails, Django, Kubernetes. Reference engines to compare against, not to vendor yet:
Mergiraf (structured merge), Spork and IntelliMerge (tree matching).

## Next

1. Score two or three corpus repos and record the numbers here.
2. Add the line-id predictor beside `overlap` and `clash`.
3. Run Mergiraf over the hunks in [merge-solutions.md](merge-solutions.md) and see what it settles.
