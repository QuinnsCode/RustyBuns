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

## The story the timeline tells

Backlog is the open-PR count over time, split by what each open PR is waiting on. Read left to right it is three acts:

1. **Calm.** Few PRs open, nothing stuck, no backlog. Normal git is fine at 9 PRs a day.
2. **Git is the wall.** The crowd grows to 150-216 PRs a day and the backlog is mostly PRs stuck on merge conflicts
   (the 10-13 cascade). This is the work for **Mervin**; his ship date is marked on the line.
3. **Then testing is the wall.** With merges flowing, the backlog that remains is red or flaky checks that nobody can
   tell are theirs. This is the work for **Ester**; her ship date is marked, and the red band shrinks after it.

Each open PR is in exactly one band at any moment: working, waiting on a merge (git), waiting on a red check
(testing), or ready. So the chart shows not just that the backlog came and went but which wall it was.

## Steps (about 1,000 agents: the week of October 7 to 14)

1. **Pull the real week.** One read-only pass (`gh`, `git`, like `jam-report.ts`) over the ~1,000 PRs: number,
   title, opened and merged time, files touched, every time it was conflicted (git said so) or red (a check
   run failed), and when each cleared. Write `swarm-week.json`, one short row per PR. Real PR numbers and
   titles, fake agents. Take the ship times of Mervin (#1516 and the merge engine PRs) and Ester from `git log`.
2. **Bands per hour.** From those rows compute, per hour, how many PRs were open and in which band
   (working / git-blocked / test-blocked / ready). Stack them into the backlog timeline. Mark Mervin's and Ester's
   ship times and the hours with no backlog. Put the calm stretches on the chart too; they are the point.
3. **One fake agent per PR.** A name and a desk, nothing running. Below the timeline, a grid of ~1,000 dots, one
   per agent, coloured by band at the playhead, so dragging the playhead shows who is stuck on what right then.
4. **Replay.** Play at 1x to 64x with the playhead moving along the timeline; dots light up as PRs open, turn
   git-red then test-amber, and clear. The jam curve from `jam-report.ts` (18% jammed with 0-2 open, 51% with 10+)
   draws under it.
5. **README with 1,000 hands in it.** At the git-wall peak, zoom into the shared README feature list: every agent's
   line with `<<<<<<<` markers piling up. Ship it as an animated SVG (GitHub strips JS) of the timeline and the
   grid, PNG fallback, from `scripts/swarm-readme.ts`, linking to the live replay.
6. **Getting Mervin'd, then Ester'd.** Past Mervin's marker the git band collapses: waves, holds, both lines kept,
   cards only for true judgment calls, and the README is whole again. Past Ester's marker the test band does the same
   as failures get sorted by owner (this PR, already red on main, flaky). The real recorded merge replay
   (`merge-replay.ts`, 5-10 merges) runs inside as the zoomed-in proof.
7. **Numbers panel.** Before and after from `jam-report.ts`, plus the honest 13% Mervin settles to other text.
8. **Wire it in.** A chapter on `#/demos`, plus a README `## Features` entry; then `bun run docs`.
9. **Test.** One journey: load the week file, play it to the end, expect every PR merged and the git and test bands
   both zero except declared cards. The `Player` (`mervin-replay.ts`) steps one event per PR file today; for 1,000
   PRs add a batched `tick`, and unit-test only that corner case.

## Decisions

- Window: the whole week (decided: "like 1000").
- README format: animated SVG, still open. GIF is the alternative.
- Scope: one PR for steps 1-6 and 8; step 7 can follow.

## Not doing

- No real agents, workers or cloud resources, and no model calls.
- No change to Mervin's engine. If the replay shows a gap, it goes to a codeSplitter issue.
- Nothing is merged or deployed from this branch; the owner reviews the PR.
