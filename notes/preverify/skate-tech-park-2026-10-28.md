# Skate Tech Park pre-verification, 2026-10-28

Run through the jump-to-state harness (`?quality`, `?weak`, `?fps`, `?controls=touch`, `?spawn=`) in Chrome on the 16 GB office Mac, plus headless rides with `bun scripts/preverify.ts [park] [spawn name]` (output: `skate-tech-park-preverify-output.txt`). The suites `test/levels.test.ts`, `scenario`, `features`, `vert`, `grinds`, `physics`, `sim` pass; judge scorecard `bun scripts/judge/score.ts` = **98.1** (pumpGain 93, vertAir 85, pushGrade 0.998).

Limits of this run: the browser window could not be resized, so 390 / 820 / 1440 px were framed as same-origin iframes at those sizes (real layout, mouse stands in for touch via `?controls=touch`). Screenshots: `img/touch-390-low.jpg`, `img/touch-1512-low.jpg`. The automation tab drops to 1 fps while hidden, so frame numbers below are from the focused tab.

One harness fix in this PR: `?spawn=vert` on Yosemite Falls picks the **bowl** wall (140, 155), where a held push gives 0 airs, not the halfpipe #2401 step 4 names. Added a `creek halfpipe` spawn (`?level=yosemite-falls&spawn=creek%20halfpipe`).

## #2535 low tier, weak-GPU step-down, readout, phone controls

| Check | Result | Evidence |
| --- | --- | --- |
| `?quality=low` renders at 1x, no shadows, no antialias | PASS | `QUALITY.low` = pixelRatio 1, shadows false, antialias false; devicePixelRatio 2 yet canvas 1512x808 (1x); readout `low · 1x` |
| `?fps` readout shows fps, ms, worst, tier, pixel ratio | PASS | `73 fps · 13.7 ms (worst 150) · low · 1x` |
| `?quality=high&weak` steps down on its own | PASS | started `high`, within ~40 s readout `19 fps · 51.5 ms (worst 60) · low · 1x`, `rustybuns.quality=low` stored |
| Tier is remembered after the step-down | PASS | `localStorage rustybuns.quality = low` (`?quality=auto` forgets it) |
| `?controls=touch` shows stick and flick pad at 390, 820, 1440 | PASS | stick 128 px at left 20 px, bottom 20 px, on screen at all three; no horizontal overflow (docW = width) |
| Console errors | PASS | none |
| Agent hook `skate_perf` returns tier and fps | PASS (code + `agent.test.ts`); the Chrome here has no `modelContext`, so not called live | |
| Cosmetic: `?controls=touch` on a desktop pointer still shows the key-hint footer under the stick, and the `?fps` pill sits over it | NOTE | footer is hidden only by `@media (pointer: coarse)`; harmless on a real phone |
| Does it start on `low` on the friend's machine | OWNER (GPU guess depends on that machine) | |
| Does low look and feel OK | TASTE | |

### Ready-to-paste replacement for #2535

> **MANUAL RUN: Skate Tech Park on the friend's weak computer (5 min, their machine)**
>
> Pre-verified by an agent 2026-10-28 (`notes/preverify/skate-tech-park-2026-10-28.md`): low is 1x with no shadows, `?weak` steps high to low and remembers it, the `?fps` readout and phone controls are right at 390/820/1440. What is left is that machine.
>
> 1. Open the live game plain (no query). Does it start on low? Look at the `?fps`-style readout by adding `?fps` to the address: `<live url>/?fps`. Last word of the pill is the tier (`low`, `mid`, `high`).
> 2. If it crawls, open `<live url>/?quality=low&fps` and ride a minute. Taste: is it smooth enough to play?
> 3. If low is fine but it did not start there, paste the GPU name here (console):
>
>        const gl = document.querySelector('canvas').getContext('webgl2'); const i = gl.getExtension('WEBGL_debug_renderer_info');
>        gl.getParameter(i.UNMASKED_RENDERER_WEBGL)
>
> 4. Optional: Two Fronts and git-recon with `?quality=low`.
>
> Part of #2529.

## #2486 retuned rounds 2 and 3

| Check | Result | Evidence |
| --- | --- | --- |
| Push from standing tops out around 58 km/h (flat) | PASS | 59 km/h on flat ground (30 s held push). On a sloped spawn it reaches 72 to 81 km/h downhill, expected |
| Ollie lower than before, apex | PASS (number) | 1.5 m apex at 8 m/s on El Capitan; `OLLIE = 5.6 * T` |
| Ollie still clears a rail and a kicker gap with boost | PASS | `test/levels.test.ts` (84 tests, gaps at 28 and 32 m/s, 63 parks) |
| Halfpipe, hold push: a couple of vert airs, then rolls out | PASS | `?level=yosemite-falls&spawn=creek%20halfpipe`: 2 airs landed on the face, no bail, ends at 59 km/h on the flat. `test/vert.test.ts` passes |
| Boosted gaps in Death Valley, Biscayne, Congaree, Everglades, White Sands | PASS | all five are in `SURVEYED` in `test/levels.test.ts`, which passes at 28 and 32 m/s |
| Judge scorecard | PASS | 98.1 v2; weakest metrics now vertAir 85, pumpGain 93 (was 68 in the issue). Open: `ollieAir 1.67`, `grindKeep 0.51` are inside the card's tolerances |
| Anything feels too sluggish / too floaty | TASTE | |

### Ready-to-paste replacement for #2486

> **MANUAL RUN: feel the retuned Skate Tech Park (rounds 2 and 3, PR #2478) (3 min)**
>
> Pre-verified by an agent 2026-10-28: flat push tops at 59 km/h, ollie apex 1.5 m, halfpipe push gives 2 airs then rolls out, all boosted gaps clear at 28 and 32 m/s on all parks, scorecard 98.1. Only feel is left. Pull main, `cd apps/skate-tech-park && bun run dev`, then:
>
> 1. Push from standing on <http://localhost:5173/?level=el-capitan>: gentle enough, or too sluggish?
> 2. Ollie: low enough? Does it still feel like a pop?
> 3. Halfpipe: <http://localhost:5173/?level=yosemite-falls&spawn=creek%20halfpipe>, hold W. Does it feel like skating a pipe?
> 4. Say which thing felt wrong and by how much; the numbers in `src/sim.ts` (`TUNE`, `LEG_PUMP`, `OLLIE`) get nudged.
>
> Part of #2427.

## #2401 grinds, balance, vert

| Check | Result | Evidence |
| --- | --- | --- |
| `?spawn=rail` lands 14 m before a bar, facing it | PASS | `test/scenario.test.ts`; on El Capitan an ollie at 0.85 s lands a grind |
| Grind names match where the deck landed | PASS (logic); feel is taste | `test/grinds.test.ts` names ten grinds by landing spot and angle. The headless pop lands a 50-50; tail and front-truck landings need the keys |
| Balance meter rocks and is savable | PASS | on a rail, hands off: balance reaches 1.0 and the rider falls (1.4 s); steering against the lean holds it (peak 0.17, rides to the end). `?spawn=balance` bar: hands off peaks 0.24 and holds; so a bar-end fall needs a push, not luck |
| Vert: held push comes back down onto the face, wall after wall | PASS | Yosemite halfpipe: 2 airs, no bail (see #2486); Half Dome vert spot: 8 landings in 15 s |
| `?spawn=vert` on Yosemite Falls goes to the halfpipe | FIXED here | was the bowl (0 airs); new `creek halfpipe` spawn |
| Rails set into a hillside are one smooth piece, rideable end to end | PASS (ride), TASTE (looks smooth) | `test/embedded.test.ts` rides each end to end |
| Too twitchy or too easy? Names feel right? Reads as one smooth piece? | TASTE | |

### Ready-to-paste replacement for #2401

> **MANUAL RUN: Skate Tech Park, feel the grinds, balance and vert (5 min)**
>
> Pre-verified by an agent 2026-10-28 (`notes/preverify/skate-tech-park-2026-10-28.md`): the spawns land, a rail grind falls hands-off and holds when steered, the halfpipe gives vert airs and rolls out, hillside rails ride end to end. Only feel and looks are left. `cd apps/skate-tech-park && bunx vite`, then:
>
> 1. Grind names: <http://localhost:5173/?level=el-capitan&spawn=rail>, ollie onto the bar. Land with the tail over the bar for a tailslide, front truck for nosegrind or crooked. Does the name match?
> 2. Balance: <http://localhost:5173/?level=el-capitan&spawn=balance>, hold the grind and A/D; then a manual with W/S. Too twitchy or too easy?
> 3. Vert: <http://localhost:5173/?level=yosemite-falls&spawn=creek%20halfpipe>, hold W; ollie high on the wall for a bigger air. Do the airs feel good?
> 4. Hillside rails: does one read as one smooth piece when you look at it?
>
> Comment what feels off; that is the next punch list.
