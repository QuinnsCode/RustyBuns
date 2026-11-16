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
The show (`?level=show`): the rig is up and the band is on stage; you run front of house. At the desk, 1 to 5 pick a channel (kick, snare, bass, guitar, vocal), [ ] move its fader, ; ' its send to the singer's wedge, , . its trim, J / K move the notch finder a third of an octave and N puts a notch there (three per channel). Enter opens the doors, or the clock does after two minutes. Three songs of our own play as stems through the desk, and the crowd meter climbs while every part sits within 3 dB of where the song wants it (the guitar 5 dB up for the solo in the second song). Feedback is computed: the vocal mic hears the wedge at their distance and angle, through the channel's trim, send and notches, and a band whose loop gain passes 0 dB rings. "More me" asks for 3 dB more in the wedge, which rings at 5 kHz unless you notch it or turn the wedge (Q / E beside it). A broken string (F by the guitarist hands up the spare) and a dying bass cable (F at the bass rig) cut that part until you fix them. Cozy names the ringing band and the fix and gives the band a minute; Sim gives 25 seconds and you find the ring by ear.

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
| `src/venues/park-view.ts` | the park on the page: grass and sky, the tent, paths, road, houses (red when over the limit), the truck, the heat map and the card |
| `src/venues/dive-bar-view.ts` | the dive bar on the page: the counter, stage and crowd marks, the heat map (repainted only when something moves) and the score card |
| `src/venues/show.ts` | the show: the band, the desk's channel strips, the set list and its cues, the vocal loop through `feedback()` in `packages/gear`, the wedge level at the singer's head, the mix against each song's targets and the crowd meter |
| `src/venues/show-view.ts` | the show on the page: the band with a marker over whoever needs you, the desk keys, the card (song, crowd, cues, what rings, the selected strip) |
| `src/audio/stems.ts` | the set's five stems per song, synthesised, each through its strip (level and notches), the dying bass, and the howl at the ringing band |
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
| `test/hearing.test.ts` | the head switched on: the cab 6 dB down at double the distance, duller behind, silent when switched off |
| `test/show.test.ts` | a set worked from the desk: the vocal brought up, more me rings and is notched, the spare guitar and the bass cable fixed on stage, the solo pushed, the crowd happy; turning the wedge stops the ring too, and a set nobody works sours the crowd |
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
(where it sits, its weight), the cables (ends, slack), the hazards and the patch (`fed`, `problems`), and `sound`: each speaker's level at your head, the high and low band totals. In the show, `state().show` is the set (song, solo, crowd, open, fixed and missed cues), `ringing` and `margin` for the vocal loop, `me` and `wants` for the wedge, the mix and the desk; `desk.nudge(channel, { fader, send, trim })`, `desk.notch(channel, hz)`, `desk.start()`, `desk.fix(kind)` and `desk.run(seconds)` play it. `power(key)` switches gear on, `speakers(up)` brings the sound up. `start()`, `walkTo(x, z)`, `pickUp(key)`, `putDown()`, `turn(dir)` and `look(yaw, pitch)`
play it without pointer lock, and `takeCable`, `plug`, `unplug`, `grabEnd`, `dropEnd`, `coil` and `wait` run the cables. In the Rusty Buns repo, `bun run probe load-in` reads it from headless Chrome.
When the game grows, grow `state()` with it, and its row in `HANDLES` (`scripts/probe.ts`).
