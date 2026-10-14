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

Reruns are incremental. Each stage is cached in `.mervin/board-cache` (`--cache <dir>` to move it, `--no-cache` to
redo everything) by main's sha, the PR's head and the state of every file it touches, so a push to one PR reruns
that stage and only the later ones that share files with it; PRs with no files in common never invalidate each
other. `--check` installs once and runs the typecheck and the touched apps' tests side by side, as CI does. A
missing dependency (no `node_modules`) stops the board at the start with "run `bun install`". The board prints
total wall time and per-stage time. Measured 2026-10-13 on 12 open PRs (59 file merges): 35.6s cold, 12.2s rerun with
every stage cached (7.0s of it merging, the rest `gh` and writing the tree).

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
held one. `--stack` joins the clean ones (go, and every file certain or agree) into one branch with git plumbing, a merge commit per PR, and opens one PR listing what's in it and what isn't and why. Merge it as a merge commit; `git revert -m1` undoes it all or one PR. Every run is recorded to `.mervin/rounds/` (PR list with head shas and CI, main's sha, the board, the verdicts, the stack's tip) and pins each PR head under `refs/mervin/`, and `--upload ephemeral-mervin-rounds` puts it in that R2 bucket (made 2026-10-14 by hand with `wrangler r2 bucket create`, named `ephemeral-` so a cleanup that lists the account's resources and deletes the `ephemeral-*` ones finds it; empty R2 bills nothing), so `--replay <file>` reruns the same decisions on exactly that input, even after a force push. The rest go in waves (wave 2 touches files wave 1 does). The merge itself is GitHub's auto-merge, so the
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

### Cascade files: land them up front or at the end (idea, not built)

Some files make every other PR fight: a lockfile, a shared `types.ts`, a barrel `index.ts`, a migration folder, a
README table. Merge one early and each open PR that touched it goes stale and needs a rebuild; merge it late
and it keeps clashing with whatever landed before. Mervin can learn which paths do this per repo and use it to
order the round.

**Measure.** A path's cascade score is how many *other* open PRs it turns stale or carded when a PR touching it
lands. Two sources, both with no file contents: the overlap map in the MervinDO (how many open PRs touch the path
right now), and the history above (how often the path's merges ended as a `card`, grouped by path hash and
extension). Keep a score per path, per directory and per extension, so a new file in a known-bad directory
starts with its neighbours' score.

**Order.** Two choices per cascade path, picked by what the PR looks like:

- *Up front* when the change is small and mechanical (a lockfile bump, a version banner, a regenerated table):
  land it first so every later PR rebuilds once onto the settled file.
- *At the end* when it is a big hand edit nobody else depends on: let the small PRs go first so it rebases once
  instead of on every wave.
- The learned weight only breaks ties in `order` (`scripts/mervin-board.ts`). Stacking and CI holds still win, and
  a PR is never moved ahead of the PR it is stacked on.

**By language.** Cascade is learned per programming language as well as per path, because languages fail
differently: a `Cargo.lock` or `bun.lock` cascades, a Rust module rarely does, and Mervin settles JS/TS and HTML
by parsing but only flags the rest (see "Where Mervin is weak"). Language comes from the extension and
`.gitattributes` (`linguist-language`), with `linguist-generated` marking lockfiles and regenerated files as
up-front candidates. Each language keeps its own score and its own up-front/at-the-end lean for the repo.

**Mini tag.** The plan line, the board and the PR card show a small language tag like GitHub's: a colored dot and
the name (`TypeScript`, `Rust`, `Markdown`), one per language the PR touches, biggest first, at most three. A
cascading language gets a small down-arrow for "goes first" or up-arrow for "goes last", with the reason as
the tooltip. Colors are fixed per language, not learned, and the tag is an icon plus a word, never a wrapping label.

**Report.** Show the score on the plan line (`wave 1, first: lockfile cascades 6 PRs`) so a person sees why a PR
was moved, and a PR list given by hand (`bun scripts/mervin-merge.ts 12 9 14`) already beats any learned weight.

Open: whether to let a repo mark paths as cascade by hand in `.gitattributes` before enough history exists.

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
