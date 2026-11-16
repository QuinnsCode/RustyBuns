# Load In

> **What it proves:** a first-person roadie sim on real numbers: you carry the gear in one piece at a time, at a pace set by its weight (a 40 kg cab is a shuffle), and set it down on the floor or stacked on another piece. Speakers first; the plan is in #4849 and `notes/game-ideas/3-studio-and-roadie.md`.

## Run it

```
bun install
bun run dev              # in the browser
bun run desktop:dev      # as the desktop app
bun test                 # the garage load-in, played by the test
```

Click to take the mouse. WASD walk, mouse look, F pick up or put down, Q / E turn what you hold, P switch on what you look at, M speakers up or down, C crouch, Esc lets go.
The dive bar (`?level=dive-bar`): set the tops on their stands, then, looking at one with your hands free, Q / E turn it, R / V tilt it, Z / X lower or raise its stand. H shows the coverage heat map, [ and ] move the master fader, and Enter opens the doors on your score. The crowd area should sit within 4 dB of 100 dB, with the bar at least 5 dB quieter so the staff can hear orders.
A gamepad works too (left stick walk, right stick look, A grab, LB / RB turn, B crouch); the cog rebinds it.

## What's in it

| File | What it does |
| --- | --- |
| `src/sim.ts` | the load-in: you, the level, carrying and setting down; plain data and one `step`, no DOM |
| `src/gear.ts` | the gear at its real sizes and weights (the ids in #4849), drawn with the models from `@rustybuns/models/gear` |
| `src/venues/dive-bar.ts` | the dive bar: the room, the crowd and bar zones, aiming (turn, tilt, raise the stand), the master fader, and the score from `coverage()` in `packages/gear` |
| `src/venues/dive-bar-view.ts` | the dive bar on the page: the counter, stage and crowd marks, the heat map (repainted only when something moves) and the score card |
| `src/main.ts` | the page: three.js in first person, pointer lock, keys and a pad, the menu, and `window.loadIn` (the harness) |
| `src/audio/hear.ts` | what you hear where you stand: each fed speaker's level at your head from `@rustybuns/gear` (distance, off-axis), how dull it is from there, and the sub band summed with phase; the `fed` hook cables fill in |
| `src/audio/play.ts` | Web Audio: our own synthesised house loop, per-speaker gain, top end and pan, one sub bus, the speakers-down card and a -1 dBFS limiter |
| `src/eqosys.ts` | the eqosys sign-in and the Qollab party client, with this game's id |
| `test/garage.test.ts` | the cab carried in from the door, set by the amp, the head stacked on it |
| `test/dive-bar.test.ts` | both tops set on their stands: pointed at the wall they score low, aimed at the crowd they pass |
| `test/hearing.test.ts` | the head switched on: the cab 6 dB down at double the distance, duller behind, silent when switched off |

## Sign-in and parties

The page plays as a guest until eqosys knows the game. To turn sign-in on:

1. On [eqosys](https://eqosys.qntbr.com), open Studio, then **Add a game**: id `load-in`, and your site's address.
2. Put the same address in `SIGN_IN_FROM` in `src/eqosys.ts`, and deploy (`bun run deploy`).

Signed in, **Make a party** gives a code to hand out; friends type it in **Join**. The host's **Start** seats everyone
(`state().party.seat`) and starts the load-in on every page. A shared crew, everyone carrying in the same garage, comes later.

## The harness

`window.loadIn.state()` returns you (place, facing, speed), what you hold, what F would pick up, and every piece of gear
(where it sits, its weight), and `sound`: each speaker's level at your head, the high and low band totals. `power(key)` switches gear on, `speakers(up)` brings the sound up. `start()`, `walkTo(x, z)`, `pickUp(key)`, `putDown()`, `turn(dir)` and `look(yaw, pitch)`
play it without pointer lock. In the Rusty Buns repo, `bun run probe load-in` reads it from headless Chrome.
When the game grows, grow `state()` with it, and its row in `HANDLES` (`scripts/probe.ts`).
