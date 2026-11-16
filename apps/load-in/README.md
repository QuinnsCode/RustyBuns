# Load In

> **What it proves:** a first-person roadie sim on real numbers: you carry the gear in one piece at a time, at a pace set by its weight (a 40 kg cab is a shuffle), and set it down on the floor or stacked on another piece. Cables come out of the road case and drag behind you as a rope at their real length; a cable across a walkway is a trip hazard until a ramp goes over it. Speakers first; the plan is in #4849 and `notes/game-ideas/3-studio-and-roadie.md`.

## Run it

```
bun install
bun run dev              # in the browser
bun run desktop:dev      # as the desktop app
bun test                 # the garage load-in and a power run, played by the tests
```

Click to take the mouse. WASD walk, mouse look, F (or a click) picks up, puts down, takes a cable from the case, plugs
it into the jack you look at or pulls it out; Q / E turn what you hold, P switch on what you look at, M speakers up or
down, C crouch, Esc lets go. A speaker with no cable in it plays once switched on; once cabled, it plays only when the
patch feeds it.
The dial under Play goes from **Cozy** (no clock, gear weighs half, a cable you let go of coils itself, ramps snap end to end, free jacks glow when you hold a cable, breakers never trip) through **Crew** to **Sim** (real weights, doors on time, breakers trip, a short cable is short). A new player starts on Crew, and the browser remembers the stop. With a clock, the doors time is at the top of the screen. Each minute late, after Crew's two minutes of grace, costs 10% of the pay and 8 points of crowd mood, and the mood scales the show score when the doors open.

The dive bar (`?level=dive-bar`): set the tops on their stands, then, looking at one with your hands free, Q / E turn it, R / V tilt it, Z / X lower or raise its stand. H shows the coverage heat map, [ and ] move the master fader, and Enter opens the doors on your score. The crowd area should sit within 4 dB of 100 dB, with the bar at least 5 dB quieter so the staff can hear orders.

The bigger bar (`?level=bigger-bar`): passive 15" tops and two subs run off the amp rack over speaker cable, two powered wedges, and wall outlets on four numbered circuits (two 20 A on the stage, 15 A at the bar and the side). The cables decide what plays. The bar's cooler is always on circuit 3, so the rack on that circuit trips it at show level. Walk to the panel on the right wall and press B to reset it, then move the plug. The card shows each circuit and how many speakers are fed.

The park (`?level=park`): a Saturday event with a pop-up tent and no wall power. F on the generator (90 kg, too heavy to lift) takes its handle and you push it in from the truck at a heavy pace; run the 25 m power cable to the distro in the tent and the short ones to the tops and the mixer, all inside the generator's 6.3 kW (past it, it trips and the park goes quiet). Cables across the lakeside path or the dog walk need a ramp, and the houses across the road have a noise limit of 82 dB at their property line: aim, tilt and the fader trade the crowd's 95 dB against the neighbours. On Cozy the generator rolls light and never trips, and ramps snap over the runs. Same keys as the dive bar; Enter is show time.
The big arena (`?level=arena`): the PA flies. Sixteen 75 kg line-array boxes and four subs wait on the dock, and the boxes are too heavy for one person (on Cozy they weigh half, so you can), so four hired hands carry what you send them, two to a box. Press 1 to 6 to pick a rigging point (the two mains, the two side hangs, the two delay towers halfway down the floor), then K on a box sends the crew with it to that point's fly bar; K on anything else tags it, and K again sends it to where you stand. At a point's motor, U flies the hang to trim and R / V angle it. , and . step a tower's delay: it should land just after the mains (0 to 20 ms), about 65 ms for these towers. The subs go to the stage edge in cardioid pairs: a second sub 0.8 m behind the first, facing the same way, with its polarity flipped (I) and its delay stepped with , and . to the time sound takes to cross the gap (2.3 ms), so the bass cancels on the band's stage and adds out front. Power is the building's company switch on the right wall: 7 picks the sub amps, and L there moves the picked feed onto the next of three 50 A legs. Everything on one leg trips it. The card scores the floor at 102 dB, the towers in time, the stage 10 dB quieter in the lows, and every leg under 80%.
A gamepad works too (left stick walk, right stick look, A grab, LB / RB turn, B crouch); the cog rebinds it.

## What's in it

| File | What it does |
| --- | --- |
| `src/sim.ts` | the load-in: you, the level, carrying and setting down; plain data and one `step`, no DOM |
| `src/venues/bigger-bar.ts` | the bigger bar: its outlets and their circuits, the cooler's house plug, the breaker panel, and `judge`, which runs the cables through `compile()` and trips what is over |
| `src/venues/bigger-bar-view.ts` | the stage, the counter, the panel with a lamp per circuit, the circuit card, B to reset; what plays comes from the judge |
| `src/assists.ts` | the cozy-to-sim dial: each assist is a named rule (`assist("autoCoil")`), one row per stop in `RULES` |
| `src/clock.ts` | the clock to doors: each venue's window and fee, the dial's stretch and grace, and what being late costs |
| `src/dial-view.ts` | the dial in the menu, the clock in the HUD, and the jack glow |
| `src/venues/dive-bar.ts` | the dive bar: the room, the crowd and bar zones, aiming (turn, tilt, raise the stand), the master fader, and the score from `coverage()` in `packages/gear` |
| `src/venues/park.ts` | the park: no outlets, the generator you push (`push`), the generator's load (`load`), the paths, and the score: the crowd, the houses' property line against its limit, clear paths |
| `src/venues/arena.ts` | the big arena: the rigging points and their hangs (fly, angle, tower delays), the subs' delay and polarity, the company switch's three legs, the hired crew (`send`, `crewTick`: carries on a timeline, two hands to a heavy box) and the score |
| `src/venues/arena-view.ts` | the arena on the page: the stage, the roof grid and each point's motor and chain, the tower scaffolds, the switch's leg lamps, the crew in hi-vis, the heat map and the card |
| `src/venues/park-view.ts` | the park on the page: grass and sky, the tent, paths, road, houses (red when over the limit), the truck, the heat map and the card |
| `src/venues/dive-bar-view.ts` | the dive bar on the page: the counter, stage and crowd marks, the heat map (repainted only when something moves) and the score card |
| `src/cables/` | cables: `rope.ts` the rope (verlet points on the floor and over the gear), `cables.ts` taking, plugging, the length stop, ramps and hazards (the patch is `compile` from `@rustybuns/gear`), `draw.ts` the tubes on screen |
| `src/main.ts` | the page: three.js in first person, pointer lock, keys and a pad, the menu, and `window.loadIn` (the harness) |
| `src/audio/hear.ts` | what you hear where you stand: each fed speaker's level at your head from `@rustybuns/gear` (distance, off-axis), how dull it is from there, and the sub band summed with phase; the `fed` hook cables fill in |
| `src/audio/play.ts` | Web Audio: our own synthesised house loop, per-speaker gain, top end and pan, one sub bus, the speakers-down card and a -1 dBFS limiter |
| `src/eqosys.ts` | the eqosys sign-in and the Qollab party client, with this game's id |
| `test/garage.test.ts` | the cab carried in from the door, set by the amp, the head stacked on it |
| `test/bigger-bar.test.ts` | cable the rig, trip the bar's breaker, reset it at the panel, move the plug, every speaker fed; four boxes on one rack channel hold, five shut it down |
| `test/dial.test.ts` | the clock read on each stop, and the same dive bar load-in on Cozy, Crew and Sim: the same layout, a different time and show |
| `test/dive-bar.test.ts` | both tops set on their stands: pointed at the wall they score low, aimed at the crowd they pass |
| `test/park.test.ts` | the generator pushed in, the tent powered from it, the path ramped, the houses under the limit; then four amp racks trip it |
| `test/arena.test.ts` | the crew carries every box to its fly bar and the subs to the stage edge, the hangs fly and the towers are timed, cardioid subs quiet the stage, the legs share the load and it passes; one leg for everything trips, plain subs fill the stage |
| `test/hearing.test.ts` | the head switched on: the cab 6 dB down at double the distance, duller behind, silent when switched off |
| `test/cables.test.ts` | power from the outlet across the way in to the speaker, the hazard, the ramp over it, a cable's length stopping you |

Sizes, weights and jacks come from `@rustybuns/gear`; the models (and where their jacks sit) from `@rustybuns/models/gear`.

## Sign-in and parties

The page plays as a guest until eqosys knows the game. To turn sign-in on:

1. On [eqosys](https://eqosys.qntbr.com), open Studio, then **Add a game**: id `load-in`, and your site's address.
2. Put the same address in `SIGN_IN_FROM` in `src/eqosys.ts`, and deploy (`bun run deploy`).

Signed in, **Make a party** gives a code to hand out; friends type it in **Join**. The host's **Start** seats everyone
(`state().party.seat`) and starts the load-in on every page. A shared crew, everyone carrying in the same garage, comes later.

## The harness

`window.loadIn.state()` returns you (place, facing, speed), what you hold, what F would pick up, and every piece of gear
(where it sits, its weight), the cables (ends, slack), the hazards and the patch (`fed`, `problems`), and `sound`: each speaker's level at your head, the high and low band totals. `power(key)` switches gear on, `speakers(up)` brings the sound up. `start()`, `walkTo(x, z)`, `pickUp(key)`, `putDown()`, `turn(dir)` and `look(yaw, pitch)`
play it without pointer lock, and `takeCable`, `plug`, `unplug`, `grabEnd`, `dropEnd`, `coil` and `wait` run the cables. In the Rusty Buns repo, `bun run probe load-in` reads it from headless Chrome.
When the game grows, grow `state()` with it, and its row in `HANDLES` (`scripts/probe.ts`).
