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

## The borg engine: Mervin on a loop

`scripts/borg-engine.ts` rolls Mervin through public git histories continuously, and keeps what people did
by hand:

```sh
bun run borg                                  # git/git, rails/rails, expressjs/express, one pass
bun run borg https://github.com/org/repo.git --limit 100 --agents 4 --loop --every 600
```

Each pass, per repo: clone bare (or fetch) into `~/.cache/borg`, replay the next `--limit` merges it has not seen
(`state.json` remembers them, so a loop walks a history back to its first merge), and tally what Mervin did with each
file git gave up on, as `mervin-corpus.ts` does. Wherever the person who merged did not land what Mervin made
(he asked, or settled to other text), the lines they added and dropped are appended to `lessons.jsonl`: the
**human edits**, the teaching set for the next resolver level. A reordering is not an edit.

With `--agents N` the same pass has a team of pretend agents rewrite the repo's latest commits into one file at once
(`scripts/borg-agents.ts`, also runnable alone: `bun scripts/borg-agents.ts <repo> [commit ...] --agents 4 --contest 0.3`).
A commit's diff is cut into units (one changed line; a run of new lines after one anchor), dealt to the agents, and
fired concurrently at the file's Durable Object on the local twins. With `--contest`, that share of the rewritten
lines also gets a second agent writing different text: two agents on one line. It passes when the file ends as the
commit wrote it, or, on a contested line, as exactly one of the texts offered. A lost update or an agent that never
lands fails the run. Nothing leaves the machine.

First pass on expressjs/express (2026-10-13, 60 conflicted merges, 183 files): 21 solved, 38 wrong, 122 cards, 138 human edits kept.
Most cards were `package.json` (both sides bump dependencies and scripts), so `package.json` now merges by key (`src/manifest.ts`): each key on its own, the higher version when both bumped one, and a card only for a script or field both rewrote. Same sample after: 36 solved, 44 wrong, 101 cards. The extra wrong are mostly people keeping the older version or moving a key, which no engine can know. The pretend team on the
latest 5 commits: 13 files, 4 exact, 9 settled on contested lines, 0 lost, 0 stuck.

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

## Dependency fights (#1477)

`src/dep-docs.ts` (imports only `manifest.ts`; the registry, OSV and the sandbox are arguments, so tests are offline):

- `detectDependencyFiles` finds manifests and the lockfiles that follow them across npm (with workspace members), Cargo, Python, Go and Ruby.
- `settleDeps` asks the dependency's docs (`npmDocs`: npm deprecation and README notes, OSV advisories) when both sides bumped one across a major. Safe docs take the higher version; a breaking finding, no docs or a spent lookup budget gives a card ("x 1.3 to 2.0 renames `foo`; branch uses it at src/a.ts:12").
- `mergeTable` merges `Cargo.toml`, `pyproject.toml` and `go.mod` dependency tables by key, as `manifest.ts` does for `package.json`.
- `proveMerge` installs and builds the merged tree in a sandbox that is destroyed on success, failure and throw. Lookups and sandbox runs each draw on a `Budget`, so a pass and a repo have a cap.

Not wired into the live merge yet (it is async, `lines.merge` is sync), and express, rails and git/git have not been re-run against the table above.
