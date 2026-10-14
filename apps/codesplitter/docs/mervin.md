# Mervin

Mervin is codeSplitter's merge engine: the line-id merge (`src/lines.ts`), the resolver levels and the
merge plan (`src/merge-plan.ts`) that puts clashing PRs in waves. It swerves out of the way of merge conflicts.

**Don't be the conflict in your git.** Git that keeps going.

Mervin keeps on swervin, so your agentic merge conflicts can stop hurting. Everyone has that "database guy";
Mervin is your agentic git and merge guy, out here solving the problems so your agent doesn't have to.

Mervin is built for the agentic era but is not an AI. It is a deterministic merge engine: no model, no
prompt, no sampling, so the same three inputs give the same merge every time, for free, in milliseconds.
It is designed for maximum collaboration with minimal friction: many agents and people on one repo at once,
their merge conflicts dissolving into merge solutions instead of piling up as work. A model only gets involved
when Mervin hands back a card, and then with the context to answer it.

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

## Learning your merge patterns (opt-in, not built yet)

Design only. The engine stays deterministic: learning never changes how a merge is computed, it changes what
Mervin notices and how he orders and flags, and it is off until a repo turns it on.

**What is kept.** One small event per merge, with no file contents and no diffs: repo, file extension, resolver
level that settled it (or `card`), whether the merged tree passed its checks, how the card was answered (main's,
the branch's, both, written, an agent), and whether the result was later reverted or edited. Paths are hashed
unless the repo says otherwise.

**Where it goes.** Cloudflare's R2 stack lets us keep it as plain tables with no database to run:

```
Mervin (Worker) -> Pipeline (stream + SQL transform) -> R2 Data Catalog (Iceberg table in R2) -> R2 SQL
```

This is the Basin skill's product set: Basin Pipelines to ingest, Basin Catalog for the Iceberg tables in R2,
Basin SQL to query across them (formerly Pipelines, R2 Data Catalog and R2 SQL). Per-repo hot state (the open-PR
overlap map) stays in the MervinDO ([mervin-engine.md](mervin-engine.md)); R2 holds the history that is too
wide for it.

**What it is asked.**

- Which file types, directories and PR pairs fight here, so the merge plan weights them: `SELECT ext, count(*)
  ... WHERE outcome = 'card' GROUP BY ext`.
- Which resolver level this repo's people accept without editing, and which settle "wrong" (answered, then
  reverted). A level with a bad record on this repo is demoted to a card, which is the self-heal.
- Which card answers repeat (always main's on `package.json`, always both on `CHANGELOG.md`): suggested first,
  or proposed as a `.gitattributes` rule for a person to approve.

**Report.** A weekly summary per repo (settled, asked, wrong, top fighting paths, rules proposed), on the repo
page and `GET /api/mervin`. Self-heal means demoting a level or suggesting a rule; it never rewrites history or
merges anything new without the same guards as today.

**Opt-in.** Off by default, per repo, switchable in settings, with delete-my-data. Nothing leaves the account
that owns the repo.

Open: event schema, retention, and whether Pipelines-to-Iceberg or plain R2 NDJSON plus R2 SQL is cheaper at
our volume (price it first, per the contest cost rule).

## Corpus to pull in

Busy repos that keep real merge commits, cloned in full (not shallow) to a scratch directory. Done: git/git and rails/rails (above).
Tried: rust-lang/cargo, which merges only green PRs through bors, so 1 of 1,600 merges was ever conflicted: no corpus.
Tried: pingdotgg/t3code, which squash-merges: 15 merge commits in 5,473, so no corpus either.
Still to check: a Linux subsystem tree, Django. Reference engines to compare against, not to vendor yet:
Mergiraf (structured merge; over the 29 hunks in [merge-solutions.md](merge-solutions.md#12-mergiraf-over-the-same-hunks) it settled 6 and nothing L3 doesn't; still to try on a corpus with moved and reordered code), Spork and IntelliMerge (tree matching).
