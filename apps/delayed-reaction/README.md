# Delayed Reaction

> **What it proves:** a rhythm game that is phone-first: four thumb pads, a synth that runs on the audio clock, presses judged after the output latency comes off, and a sim with no page in it that a test can play through. Its later rounds were each built by three agents at once (the tunnel, the runner, the sim and music) from one spec in [VISION.md](VISION.md), each owning its own files and coding to a few named functions the others promised (`floorAt`, `runnerX`, `knockback`), so none waited on another's unmerged work; a fourth wired them together and played it through. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

You sprint down an endless neon grid tunnel that rolls slowly round you, near-white lines on black, to a deep dub loop: half-time drums, a wobbling bass, a skank on the offbeat. Far down the tunnel a ring lights up in a lane's colour and calls out a note. *Later* (two beats, a bar, two bars, whatever the level's delay is) a wall fills the tunnel with one door in it, in that lane, and the four pads move you across the floor: far left, left, right, far right. Be standing in the door when the wall arrives and you run through; be anywhere else and you bounce off it. While you wait, more rings call, so you carry a queue of doors in your head and move to each on its beat, like a dub delay playing back what the tunnel said. Long calls are long doors: get in and stay in until they end. Every answer explodes in its lane's colour, and the explosion echoes back, smaller, on every repeat of the delay.

- **The delay is the game.** A ring calls at beat *b*; its wall arrives at *b + delay*. Moving is free, so the only way to lose is to be in the wrong place when a wall comes: step across a beat too soon and the wall before your door, whose door is somewhere else, knocks you back. Nothing else about the timing is hidden: a call is a tail of rings, one a beat from the call to the answer, dimmer each one, so you watch the delay count down as they rush at you, and the last reaches the runner exactly on its due beat, so once you learn the song you can play it by ear with the screen covered.
- **The music tells you when, at first.** In the early levels the call comes round again on its due beat, quieter, through the delay line: you answer on the echo. The pad also takes its lane's colour while its key is in the window. The echo fades level by level and is gone by level five, when you carry the timing yourself.
- **Polyphonic.** With a bar of delay and two calls a bar, two or three answers are always in flight. The dots over the runner's head are the queue you are carrying.
- **An endless turn.** The tunnel rolls round its axis one way, forever, and bends off the way it is rolling, so it is always rounding a corner and never arrives. Its long lines spiral with the roll, a fainter grid rolls the same way at a slower rate for a moiré that crawls round the walls, a ring passes every beat (brighter on the bar) and a wave of light runs off ahead of you on each bar. The four lanes are four places round the pipe, left and right up its sides and far left and far right nearly on the roof, and the camera is strapped to the runner: a sidestep swings the whole pipe round them and settles, with the runner always at the bottom of the screen.
- **A wall with a door.** Where an answer is due, a solid wall of neon grid fills the tunnel in the call's colour, with one door: a glowing arch at the call's lane, white-hot at the sill. The call's tail of rings counts the beats down to it. A hold's door runs on as a corridor until the hold ends.
- **Colour is the only reward.** The tunnel is near-white on black; only calls, answers and the runner's accents have colour. A hit is a fluid explosion in the lane's colour, white-hot at the core on a perfect: particles that fly out, drag to a drift and smear along their path, while the walls catch the flash. The dub echo re-fires it `delay` beats later, smaller, up to three times, so what you see is what the delay line is doing.
- **Your answers echo.** Going through a door is a whoosh of air and the note an octave up through a feedback delay set to the level's delay, so it comes back on the beat it would have been due again, darker each pass. Perfect answers are a brighter wave. A wall is a dull body thud that echoes too.
- **Speed is earned.** An answer on time boosts the run (a perfect more than a good), up to two and a half times; a bounce off a wall cuts most of it, and it drifts back to the floor on its own. The charts stay in beats: speed changes how fast the world looks and sounds, never when an answer is due. Going faster opens the filter and brings in sixteenth-note hats; the fence slams the filter shut, drops the hats and turns everything down for half a bar.
- **You can hear the delay count down.** Between a call and its due beat the call's note ticks softly on every beat, quieter each time, so the tail is audible as well as visible.
- **A runner with some swagger.** Drawn in lines and curves, no images: a neon-outlined sprinter in a padded jacket and shades, hair in the wind, who sways while idle, strides on the beat, banks hard into a lane change like a car on a banked curve (harder the further it jumps, a streak sweeping off behind) and settles upright as the camera swings round behind, dives shoulder-first through a door, is thrown back off a wall with arms up and recovers, punches toward a held pad, stumbles after a miss and leans into a boost with a streak behind. A hit's explosion goes off at the door the runner went through, and so do its echoes.
- **Phone first.** Four pads that are each a quarter of the width and a fifth of the height, pointer events with capture so a thumb that slides off a pad still lets go, no zoom, no scroll, the safe areas respected, a short buzz on hits and a long one on misses. The desktop gets `D` `F` `J` `K` (or the arrow keys) and the same pads. A cog in the corner opens Controls: the key list, plus look X and Y speeds and invert Y (they scale how far the tunnel sways, since the game has no mouse look; touch speed has no use here), saved between visits.
- **Judged where you heard it.** The press is compared to the beat you heard, not the beat the clock is at: the audio output latency, which on a phone can be 100 ms, is subtracted first.
- **Six levels.** Tempo climbs from 120 to 148 bpm (half-time, so it feels like 60 to 74); the delay is a bar for the first three, then two bars, then an odd six beats. Each level is seeded, so retrying it is the same song.
- **Deep dub, synthesized.** Kick on the one and snare on the three, a bass a bar long whose filter wobbles at a rate the bar picks, a sine sub under it for headphones, a square-wave skank on the offbeats straight into the delay line, and a slow lowpass sweep over everything.
- **Twelve arranged tracks.** `?setup=snap` and its eleven siblings play a structured track instead of the loop: 64 or 128 bars at 86 bpm (or 86 sped up 1.3x) laid out as intro, build, drop, break, rise, drop and outro. Very half-time: a kick on the one and a snap clap (or a snare, or a rim) on the three, grooved eighth hats, eighth-note ticks into the dub, growls that stretch over 8 or 16 bars, a quick triplet rise and cut before each drop, a one-note synth, stompy toms under some drops. Drums, bass and most stabs hit mono; some setups open the stabs out wide with reverb, and each puts its dub delay on the instrument, on the bus, or both. The arrangement is pure data in `src/dub.ts`; `bun scripts/render.ts --all` renders every track offline and checks its numbers.

Built with the Web Audio API, a canvas and [Rusty Buns](../../README.md). The wild ideas that haven't landed yet are in [IDEAS.md](IDEAS.md); the owner's direction for it is in [VISION.md](VISION.md).

## Jump to the state

A link lands on the menu with one extra button, **Go**, that starts that exact state (a tap, because the browser wants one before it plays sound). Every field is optional and out-of-range values are clamped:

| Param | Meaning |
|---|---|
| `level` | 1 to 6: the song |
| `beat` | start this far into the song; walls already due are answered |
| `speed` | 1 to 2.5, the boost you arrive with |
| `delay` | beats between a call and its wall (a bar is 4) |
| `bpm`, `hint` | tempo, and how loud the echo on the due beat is (`0` = by ear) |
| `lane` | 0 to 3, where the runner stands |
| `stem` | `drums`, `bass`, `synth` or `dub`: hear one part of the mix alone |
| `setup` | one of the twelve arranged dub tracks in `src/dub.ts` (`snap`, `warren`, `lowtide`, `stomp`, `fog`, `ember`, `rush`, `chase`, `drift`, `tribe`, `hollow`, `longtail`): its tempo, delay and 64 or 128 bars, unless `bpm` or `delay` say otherwise |

For example `?level=5&beat=40&speed=2&delay=6&hint=0&lane=3`. An agent gets the same setter as `window.delayedReaction.start({ level, beat, ... })` (it answers with the link) and `window.delayedReaction.state()`, and as the WebMCP tools `dr_start` and `dr_state` where the browser has them. The parsing is `src/scenario.ts`.

## Run it

```
cd apps/delayed-reaction
bun install
bun run dev              # on your phone: open the LAN address vite prints
bun run desktop:dev      # as the desktop app
bun test                 # a full run through every level, judged by the sim
```

| | |
|---|---|
| Move | the four buttons, or `D` `F` `J` `K`, or the arrow keys: far left, left, right, far right |
| Long doors | stay in the lane until the door ends |
| Mute | `M` |
| Quit a run | `Esc` |

**Scoring:** stepping into the door within about 43 ms of its wall (at 140 bpm) is a perfect, 100; within about 107 ms a good, 60; already standing there when it arrives is a good. Times a combo multiplier that steps up every ten in a row, up to 4x. A long door is one answer, graded on how you came in; leaving before it ends is a bounce. A bounce costs a life, the combo and most of your speed. Eight bounces and the song stops.

`src/sim.ts` is the game: charts, the run, where the runner stands (`runnerX`, `knockback`), the walls and doors, in beats with no DOM. `src/audio.ts` is the loop and the dub delay. `src/hallway.ts` projects the tunnel, the rings and the explosions onto the canvas; `src/runner.ts` draws the runner, a neon-outlined sprinter in a padded jacket and shades who sways, strides, banks into lane changes, dives through doors, bounces off walls, punches toward a held pad, stumbles on a miss and leans into a boost. `src/main.ts` wires them and listens.
