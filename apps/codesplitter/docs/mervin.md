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
touched a file) and `clash` (git's merge of the midpoints already conflicts). A line-id predictor (`lines`, added beside them) and the
Mervin plan go next to them once there is a corpus to hold them to. For what Mervin does once branches meet, see `mervin-corpus.ts` below.

Needs repos with real merge commits. This repo squash-merges, so it scores nothing; use its replay
(`scripts/merge-plan.ts`) for its own history and the scorecard for pulled-in repos.

## What Mervin settles on a big repo (git/git)

`scripts/mervin-score.ts` asks whether a fight was seen coming. `scripts/mervin-corpus.ts` asks what happens
once two branches did meet:

```sh
git clone --bare https://github.com/git/git.git git.git
bun scripts/mervin-corpus.ts git.git --limit 400 --show 60
```

It walks every two-parent merge (not only first-parent: a repo that merges only green PRs keeps its hand-settled
conflicts in "merge main into the branch" commits), keeps the ones git's own merge-tree conflicts on, and
runs each conflicted file through `shadow()` with the merge commit's copy as the truth.

Measured 2026-10-13 on git/git: 3,718 merges scanned, 400 conflicted in git, 470 conflicted text files (218
more skipped: binary, over 3,000 lines, deleted on a side, symlinks).

| What Mervin did with a file git gave up on | Files | Share |
|---|---|---|
| **solved**: settled to exactly what the person committed | 200 | 43% |
| **close**: same lines in another order, or the same text bar indentation | 27 | 6% |
| **wrong**: settled clean to other text | 59 | 13% |
| **cards**: handed back to ask | 181 | 39% |
| gap: git merges it clean, Mervin conflicts | 1 | |

By language: C solved 102 of 200 (51%), shell 46 of 67 (69%), headers 19 of 51 (37%). Build files, `.gitignore`
and extensionless files (RelNotes, Makefile fragments, test scripts) are the weak spots.

`wrong` is an upper bound on silent corruption: a person resolving a conflict often edits more than the
conflict (adapts a call site to a rename on the other side), and no merge engine matches that. But the sample
shows two real engine faults:

1. **Two rewrites of one statement landed together.** Both sides wrapped one signature line onto two lines and
   ended it differently (`unsigned flags)` / `enum object_info_flags flags)`); the stretch-blend kept both
   endings, leaving the parameter declared twice. Fixed here (`splitDifferently`, `blend` in `src/lines.ts`):
   those asks as a card now. 63 wrong became 59, solved did not move.
2. **A block one side moved while the other edited around it** (odb.h) comes out with its comment split. Not fixed.

## Where Mervin is weak

- **Code outside JS/TS is unguarded.** `src/lint.ts` parses only JavaScript, TypeScript and HTML. A clean merge
  of C, Rust, Python or Go that no longer builds goes out clean. All of git/git's C and shell sits outside it.
- **Silent beats asking.** 13% of git's conflicts came out clean and different. The next guard is language
  agnostic: a file git conflicted on and Mervin merged clean should say so (a check, like the prose fact
  checks), with the build as the arbiter where the repo has one.
- **Never run on anyone else's history until now.** The 80% goal in this doc is about seeing fights coming; the
  recall number for it (mervin-score) still needs a corpus that keeps real merges (the `lines` predictor is in).
- **Invisible.** The name is in no UI string, README line or API field; the merge engine is the strongest answer
  to the contest's conflict-handling criterion and a judge cannot see it.

## Corpus to pull in

Busy repos that keep real merge commits, cloned in full (not shallow) to a scratch directory. Done: git/git (above).
Tried: rust-lang/cargo, which merges only green PRs through bors, so 1 of 1,600 merges was ever conflicted: no corpus.
Still to check: Linux subsystem trees, Rails, Django. Reference engines to compare against, not to vendor yet:
Mergiraf (structured merge), Spork and IntelliMerge (tree matching).

## Next

1. Run `mervin-corpus.ts` on a second repo with a different language mix (Linux subsystem tree, Rails) and record it here.
2. Run `mervin-score.ts` (now with `lines`) on a corpus that keeps real merges and record recall here; add the merge plan as a predictor.
3. A language-agnostic "settled but git would have stopped" check for code that `lint.ts` cannot parse.
4. Run Mergiraf over the hunks in [merge-solutions.md](merge-solutions.md) and see what it settles.
5. Show Mervin: a corpus number on the repo page, and the merge plan's waves with his name on them.
