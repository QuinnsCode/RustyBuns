# Mervin

Mervin is codeSplitter's merge engine: the line-id merge (`src/lines.ts`), the resolver levels and the
merge plan (`src/merge-plan.ts`) that puts clashing PRs in waves. It swerves out of the way of merge conflicts.

**Don't be the conflict in your git.** Git that keeps going.

Mervin keeps on swervin, so your agentic merge conflicts can stop hurting. Everyone has that "database guy";
Mervin is your agentic git and merge guy, out here solving the problems so your agent doesn't have to.

Mervin is the merge engine this agentic era needs, and layered with a sync layer it makes agents go brrrr.
Let Mervin bring the intelligence to your merges, so you don't spend precious token budget on them and
human minds are free to steer the digsite.

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
recall (fights flagged ahead) and precision (flags that fought) for four predictors: `overlap` (both sides
touched a file), `clash` (git's merge of the midpoints already conflicts), `lines` (the line-id merge of the midpoints
leaves cards) and `plan` (a commit that landed on the mainline since the base clashes with the midpoint on a file both
touched: the merge plan would have put the branch in a wave behind it). For what Mervin does once branches meet, see `mervin-corpus.ts` below.

### Recall on a corpus with real merges (expressjs/express)

```sh
git clone --bare https://github.com/expressjs/express.git express.git   # 11 MB
bun scripts/mervin-score.ts express.git --limit 400
```

Measured 2026-10-13: 202 merged PRs, 67 fought.

| Predictor | Flagged | Recall | Precision |
|---|---|---|---|
| overlap | 68 | 91% | 90% |
| clash | 62 | 88% | 95% |
| lines | 54 | 79% | 98% |
| plan | 57 | 84% | 98% |

The plan clears the 80% goal at 98% precision; the line-id predictor alone sits just under it. Express is one small
JavaScript repo: a bigger, mixed-language corpus is next (a full git/git clone dropped twice mid-download).

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

## Mervin on the open PR board

```sh
bun scripts/mervin-board.ts            # every open PR, oldest first, stacked ones after their base
bun scripts/mervin-board.ts --check    # also install, typecheck and test the merged tree in a sandbox
bun scripts/mervin-board.ts --score <dir>   # after the real merge round: was the sandbox right?
```

The scorecard and corpus replay old merges. This one merges the board you have now, one stage per PR, onto
`origin/main` in a temp folder, and files each file in a tier:

- **certain**: no one else changed the file since the PR's base, so it's the PR's own copy. No merge logic ran,
  which is what makes it 100%.
- **agree**: git and Mervin both merge it clean, to the same text.
- **mervin**: git conflicts and Mervin settles it. These are the files that need `--check` to trust.
- **differ**: both clean, different text. Look at these.
- **card**: Mervin asks. That PR's change to the file isn't in the tree.

It only reads git and `gh pr list`. It never writes a ref, pushes or touches a worktree, and each run gets its
own folder, so agents can run it side by side. `--check` builds in shadow.ts's sandbox (empty HOME, none of
the shell's env).

Merge the board for real the usual way: PRs, CI, the merge round. The sandbox tree is a forecast and never
gets pushed. Afterwards `--score` compares each file the sandbox wrote with main: **exact**, **close** (same
lines reordered, or only indentation differs), **wrong** (a silent bad merge, so make it a fixture in
`test/conflicts.test.ts`), or **asked** (a card, and what landed is the answer). It also prints each tier's
record, so "certain" and "mervin" earn their confidence from real rounds. Files a commit from outside the board
touched are `moved` and aren't scored, and neither are files of PRs that haven't landed.

Measured 2026-10-13 on 19 open PRs: 125 file merges, certain 91 (73%), agree 26, mervin 7, differ 0, card 1
(`shares.ts`, #1467 after #1456). `--check`: the merged tree typechecks, but codeSplitter's tests and one hippo-tycoon
test fail where main passes. Six of the 19 PRs are already red on their own (#1432, #1442, #1455, #1457, #1458,
#1476), which accounts for those, and #1432's migration shares its stamp (`20261013040000`) with one already on
main: a clash every per-file merge rates "certain". So a red board says to fix the red PRs first, and "certain"
covers one file's text, not the files around it.

## Mervin runs the merge round

```sh
bun scripts/mervin-merge.ts          # the plan: wave, or HOLD and why, one stamped line per PR
bun scripts/mervin-merge.ts --go     # turn on `gh pr merge --auto --squash` for wave 1 only
bun scripts/mervin-merge.ts --stack --push   # join the clean PRs into one PR, one merge commit each
```

This is the decision the office's PR agent made (#1506), taken over: Mervin reads the board and holds a PR whose
CI failed, whose file he carded, that clashes across files, that is stacked on an open PR, or that waits behind a
held one. `--stack` joins the clean ones (go, and every file certain or agree) into one branch with git plumbing, a merge commit per PR, and opens one PR listing what's in it and what isn't and why. Merge it as a merge commit; `git revert -m1` undoes it all or one PR. The rest go in waves (wave 2 touches files wave 1 does). The merge itself is GitHub's auto-merge, so the
ruleset on `main` still decides. After a wave lands, run it again: the board is rebuilt on the new main. The lines
are stamped so the owner can tail a run. Not done yet: running it inside a codeSplitter sandbox box, and pushing
alerts as it goes (the stdout lines are the feed for that).

## Where Mervin is weak

- **Code outside JS/TS is only flagged.** `src/lint.ts` parses only JavaScript, TypeScript and HTML. For the rest
  (C, Rust, Python, Go, shell) a stretch both sides changed where git would have stopped, and Mervin settled, now
  comes back as a `check` (#1389), like the prose fact checks: it never holds the merge, and the writer can settle it
  with a text. Where the repo has a `package.json` with a `test` or `build` script and test merges is on, that script runs on the merged tree first, and a failure comes back as a `lint:tests` conflict (#1401), settled as the branch to land anyway. Repos with no `package.json` run `make` (a Makefile), `cargo build` (Cargo.toml) or `go build ./...` (go.mod) instead, with nothing installed first (#1407); with none of those they are still only flagged.
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
Mergiraf (structured merge; over the 29 hunks in [merge-solutions.md](merge-solutions.md#12-mergiraf-over-the-same-hunks) it settled 6 and nothing L3 doesn't; still to try on a corpus with moved and reordered code), Spork and IntelliMerge (tree matching).
