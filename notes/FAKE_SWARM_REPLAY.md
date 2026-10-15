# Fake agent swarm: replay a real merge-conflict pain, then Mervin it away

The story: the 10-13 cascade. Many workers branched from a stale `main`, every PR conflicted with the one before it,
and the merge queue fell behind. We replay that from this repo's own history with made-up agents (no model, no spend),
show the swarm stuck in a README, then show Mervin settling the round.

Most of the machinery exists. This plan wires it together; it adds one fixture, one generator and one README section.

## What already exists

| Piece | Where |
|---|---|
| Real conflicted merges replayed through the app, compared with what the person committed | `apps/codesplitter/scripts/merge-replay.ts` (`--recent N`) |
| A merge round as a recorded JSON (board stages, verdicts, lanes) | `scripts/mervin-merge.ts`, `.mervin/rounds/*.json` |
| Replay engine with play, pause, step, speed, files streaming in and settling, cards | `src/mervin-replay.ts`, `src/mervin-watch.html` |
| Jam numbers (23% jammed, 51% with 10+ PRs open) and the curve | `scripts/jam-report.ts`, `docs/jams.md`, `docs/jams-curve.svg` |
| Why it matters, with the findings | `docs/mervin-and-ester.md` |

## Steps

1. **Pick the pain.** Take the 10-13 cascade window from `gh pr list --state merged` plus `git log`. Pick 8-12 PRs that
   really overlapped: the same few files (README feature list, `features.ts`, migrations numbering). Record the PR
   numbers and the files they stepped on in one table. Real PR numbers and titles, fake agents.
2. **Make the fake agents.** One name and desk per PR (Agent 1 ... Agent N), each with the branch, the base it
   started from (stale `main` sha) and its files. No process runs; an agent is a row in the fixture. Names are
   made up. No game or studio names (see AGENTS.md).
3. **Record the round once.** Run `merge-replay.ts` on the chosen merge commits to get, per PR, git's verdict
   (conflict or clean) and what Mervin settles to. Write it as a `Round` fixture:
   `apps/codesplitter/test/fixtures/swarm-round.json` (board stages with `lines` for the README conflicts,
   verdicts with waves, `lanes` for build and deploy). Commit the file; replays never hit the network.
4. **Act 1, the pain (git only).** Add a `stuck` view of the same fixture: every PR as a desk in a grid, a red
   conflict marker on each file git gave up on, the queue count climbing, and the wait clock ticking up
   (fixed width). This is the "before": agents idle on each other.
5. **Act 2, the README.** Render the swarm inside a README, as the user asked: the stuck desks, the shared
   `README.md` feature list with `<<<<<<<` markers from N agents at once. GitHub strips JS, so ship it as a generated
   animated SVG (SMIL) plus a static PNG fallback from `scripts/swarm-readme.ts`, embedded in the root or
   `apps/codesplitter` README, with a link to the live replay at `#/demos`.
6. **Act 3, getting Mervin'd.** Play the fixture through `mervin-replay.ts`: Mervin reads the open PRs, puts them
   in waves, holds the ones that must wait, settles each README conflict (both lines kept, in order), cards only
   the true judgment calls, then each desk flips green and the queue drains to 0. End on the same README with the
   markers gone and every agent's line present. Lucide icons, no emojis.
7. **Show how you solved it.** A closing panel with the real numbers from `jam-report.ts` before and after
   (jam rate, minutes waiting) and the honest 13% of files Mervin does not get exactly right
   (see `docs/mervin-and-ester.md`). Link `docs/mervin.md` and `docs/jams.md`.
8. **Wire it in.** Add the swarm as a chapter on the existing `#/demos` page (the tour's chapters). Add an entry
   under `## Features` in the README (one line, details in `<details>`), then `bun run docs`.
9. **Test it.** One journey: load the fixture, play it to the end, expect no conflict left, all PRs merged, only
   the declared cards open. Generator unit test only for the corner case (a fixture with zero conflicts). Run only
   the touched files, as AGENTS.md says. No assertions on SVG markup.

## Decisions for you

- **Which window**: the 10-13 cascade (my pick, it is the one you named in memory), or the 966-PR week as a whole.
- **README format**: animated SVG (plays on GitHub, no JS) or a recorded GIF. SVG is smaller and crisp; GIF is
  easier to share on social.
- **Scope**: steps 1-6 and 8 are the core. Step 7's before/after numbers can be a follow-up issue.

## Not doing

- No real agents, workers or cloud resources, and no model calls.
- No change to Mervin's engine. If the replay shows a gap, it goes to a codeSplitter issue.
- Nothing is merged or deployed from this branch; the owner reviews the PR.
