# Handoff: the swarm demo (PR #1828)

Two demos on branch `office/swarm-week`, PR #1828. **It is a demo branch, not for `main`.** Until October 21, 2026
`main` has to match the contest video (AGENTS.md), so don't merge it, and push to this branch, not to `main`.

Open items: #1852 (the dots explainer) and #1829 (the real-week replay). The original plan is
`notes/FAKE_SWARM_REPLAY.md`.

## What's here

### 1. Git at swarm speed, explained with dots (`/swarm.html`, plus a section on the landing page)

A simulation of agents getting work into main: the old git way first, then codeSplitter's layers one at a time.

| File | What it is |
|---|---|
| `apps/codesplitter/src/swarm-sim.ts` | The engine, with no DOM and seeded. Each layer is a switch: `coord` (a Durable Object: a wide lane), `mervin` (seats PRs on the bullet train, settles 6 conflicts in 10 by line id, benches the rest as cards), `ester` (4 PRs per test run, flaky reds rerun, only a PR's own red goes back). All off is the old git way: one lane, a merge wall, a test wall. |
| `apps/codesplitter/src/swarm-story.ts` | The scenes, as data: title, caption, layers, where the faders glide to, what to point at, and `wipe` for a fresh crowd behind a wipe. |
| `apps/codesplitter/src/swarm-stage.js` | The canvas renderer and controls. `mount(el, {mode, embed})` builds it in any element. Plain JS so it can use the DOM (the app's tsconfig has no DOM lib). |
| `apps/codesplitter/src/swarm.html` | The full page: the stage, then six cards (old way, the two walls, the three layers), each with a "Show me" button. |
| `apps/codesplitter/src/client.html` | The landing page mounts the stage under the hero (a dynamic `import("/swarm-stage.js")`). The site sends `frame-ancestors 'none'`, so it can't be an iframe. |
| `apps/codesplitter/test/swarm-sim.test.ts` | Each layer takes down the wall the story says it does, same seed gives the same run, layers flip mid-run safely, and the story clock works. |

Modes: **Story** (guided: each scene waits at its end for Next or the right arrow; the timer button plays it on its own),
**Old git**, **Layer by layer** (the three switches), **Side by side** (old on top, codeSplitter below, the same seed).
Faders: speed (0.25x-1.5x), agents (1-50), overlap (how often features share a file, like the README) and red checks.
URL params: `?mode=old|layers|split|story` and `?scene=<id>`.

The story goes: old git with a few people, then agents, then "notice something", then swarms, then smart swarms, then
wall one (merge conflicts), wall two (red checks), everyone stuck, then layer one (Durable Object · Artifacts),
"but they still pulled a stale tree", layer two (Mervin's bullet train), "merge conflicts? what are those", the stations
back up, layer three (Ester stacks the stations), and side by side.

### 2. A real week replayed (`/swarm-watch.html`)

1,000 real PRs from October 7 to 14, each one a made-up agent. It shows the backlog chart split by what each PR waited
on, Mervin's and Ester's ship marks, and the shared file the stuck agents piled into. Files: `scripts/swarm-week.ts`
(read-only `gh`/`git` collector, writing `src/swarm-week.json`), `src/swarm-replay.ts`, `src/swarm-watch.html`,
`scripts/swarm-readme.ts` (an animated SVG in `docs/swarm-week.svg`), and `test/swarm-replay.test.ts`.

## The picture: a rush-hour station

The stage is drawn as a subway: agents come down stairs (one narrow flight the old way, wide with the Durable Object), through a ticket gate (the merge wall). Mervin is a plain function, not an AI, so he loads `TRACKS` (4) bullet trains at once. The four tracks run into one exit (the tests), where Ester loads the cars full like a flight crew. Trains lift off and fade at the far end; agents step onto parallel platforms, land in main, then go underground back to their desks. Copy is written for high schoolers: keep it that way.

## Decisions already made (don't relitigate without the owner)

- **No host's name on the jammed lane.** It's "the old git way". The contest rules ban attacks on competitor products
  in the app, demo or docs.
- **Calibrated to real rates, not hype.** At 30 agents the old way lands about 8 PRs an hour (this repo really did about 9)
  and codeSplitter about 25, roughly 3x. The owner said earlier versions were "way too fast" twice: keep it slow.
  Constants are at the top of `swarm-sim.ts`; the pace (`BASE`, `SPEEDS`, the glide rate) is at the top of `swarm-stage.js`.
- **Three layers, with Artifacts inside layer one** ("Durable Object · Artifacts").
- **Ester comes after Mervin** in the story (merge, then tests), even though she also batches PRs that don't conflict.

## Run it

```sh
bun install --frozen-lockfile                     # at the repo root, once per worktree
cd apps/codesplitter
bun build.ts                                      # writes dist/client
bun -e 'Bun.serve({ port: 4188, fetch: (r) => new Response(Bun.file("dist/client" + (new URL(r.url).pathname === "/" ? "/swarm.html" : new URL(r.url).pathname))) })'
# open http://localhost:4188/swarm.html (or /swarm-watch.html, or /index.html for the landing section)
bun test test/swarm-sim.test.ts test/swarm-replay.test.ts
```

A Chrome tab driven by automation reports itself hidden, which throttles animation frames and timers and pauses the
SVG's animation. Captions and the clock lag there; a real tab doesn't.

## Next, in order

1. Owner walkthrough of the story copy and pace (#1852). Change nothing big before that.
2. Light theme, phone width and reduced motion (#1852).
3. The landing section in the real app, not just the static build (#1852).
4. A journey test for the stage (#1852).
5. The real-week replay's leftovers: the in-page Mervin replay, the numbers panel and a PNG fallback (#1829).
