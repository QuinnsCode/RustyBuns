# Mervin

Mervin is codeSplitter's merge engine: the line-id merge (`src/lines.ts`), the resolver levels and the
merge plan (`src/merge-plan.ts`) that puts clashing PRs in waves. It swerves out of the way of merge conflicts.

Design note for running it locally and on Cloudflare: [mervin-engine.md](mervin-engine.md).

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
2. **A block one side moved while the other edited around it** (odb.h) came out with its comment split: the stretch-blend dropped the branch's `*/`, `/*` and blank lines as "the same line main added". Fixed here (`blend` in `src/lines.ts`, #1390): only a line with some text counts as the same; the merge is well formed, main's block first.

## What Mervin settles on Rails (Ruby, Markdown)

```sh
git clone --bare https://github.com/rails/rails.git rails.git
bun scripts/mervin-corpus.ts rails.git --limit 400 --show 30
```

Measured 2026-10-13 on rails/rails: 16,000 merges scanned (the walk stops at `--limit` x 40; Rails has 26,585),
251 conflicted in git, 298 conflicted files replayed (3 skipped). Only 251 of 400 fights were found in that
window, so that is the whole sample.

| What Mervin did with a file git gave up on | Files | Share |
|---|---|---|
| **solved**: settled to exactly what the person committed | 80 | 27% |
| **close**: same lines in another order, or the same text bar indentation | 82 | 28% |
| **wrong**: settled clean to other text | 85 | 29% |
| **cards**: handed back to ask | 42 | 14% |
| lock: lockfiles, left to the package manager | 9 | 3% |
| gap: git merges it clean, Mervin conflicts | 0 | |

By language: Ruby solved 24 of 77 (31%) and asked on 31 (40%); Markdown solved 51 of 204 (25%), close on 81,
wrong on 62. Markdown is 68% of the sample, nearly all `CHANGELOG.md` and guides.

Against git/git: solved plus close is 54% here and 48% there, and `wrong` is 29% against 13%, so the silent
bad-merge rate more than doubles on this mix. It is a Markdown problem, not a Ruby one: 62 of the 85 wrong
files are `.md`, and 21 of the 77 Ruby files. Of the first 30 wrong files listed, 23 are `CHANGELOG.md`, the file
where both branches add an entry at the top and the person who merged chose an order or reworded one. Whether
those are engine faults or the person editing around the conflict is not yet looked at: pull a few and diff
them against `landed` before changing the resolver. Ruby is the other finding: the weak spot is cards (40%),
not silent mistakes, and Ruby has no `lint.ts` guard (see below).

## Where Mervin is weak

- **Code outside JS/TS is only flagged.** `src/lint.ts` parses only JavaScript, TypeScript and HTML. For the rest
  (C, Rust, Python, Go, shell) a stretch both sides changed where git would have stopped, and Mervin settled, now
  comes back as a `check` (#1389), like the prose fact checks: it never holds the merge, and the writer can settle it
  with a text. Where the repo has a `package.json` with a `test` or `build` script and test merges is on, that script runs on the merged tree first, and a failure comes back as a `lint:tests` conflict (#1401), settled as the branch to land anyway. Repos with no `package.json` (git/git's make) are still only flagged.
- **Never run on anyone else's history until now.** The 80% goal in this doc is about seeing fights coming; the
  recall number for it (mervin-score) still needs a corpus that keeps real merges (the `lines` predictor is in).
- **Visible now, thinly.** The merge plan line and `GET /api/repos/:o/:r/merge-plan` (`engine`) name him, and the repo page
  and `GET /api/mervin` show the git/git corpus (settled / asked / other text, `src/mervin.ts`). The numbers there are
  this doc's table, not a live per-repo tally, and the merge page does not credit him per file yet.

## Corpus to pull in

Busy repos that keep real merge commits, cloned in full (not shallow) to a scratch directory. Done: git/git and rails/rails (above).
Tried: rust-lang/cargo, which merges only green PRs through bors, so 1 of 1,600 merges was ever conflicted: no corpus.
Tried: pingdotgg/t3code, which squash-merges: 15 merge commits in 5,473, so no corpus either.
Still to check: a Linux subsystem tree, Django. Reference engines to compare against, not to vendor yet:
Mergiraf (structured merge), Spork and IntelliMerge (tree matching).

## Next

1. Look at Rails' 85 wrong files, starting with `CHANGELOG.md` (both sides prepend an entry), and fix what is an engine fault.
2. Run `mervin-score.ts` (now with `lines`) on a corpus that keeps real merges and record recall here; add the merge plan as a predictor.
3. Build commands for repos with no `package.json` (make, cargo, go) as the arbiter.
4. Run Mergiraf over the hunks in [merge-solutions.md](merge-solutions.md) and see what it settles.
5. Show Mervin: a corpus number on the repo page, and the merge plan's waves with his name on them.
