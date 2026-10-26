# Delayed Reaction

> **What it proves:** a rhythm game that is phone-first: four thumb pads, a synth that runs on the audio clock, presses judged after the output latency comes off, and a sim with no page in it that a test can play through. Its second round was built by three agents at once (the tunnel, the runner, the speed) from one spec, each owning its own files, and a fourth wired them together. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

You sprint down an endless neon grid tunnel that rolls slowly round you, near-white lines on black, to a deep dub loop: half-time drums, a wobbling bass, a skank on the offbeat. Far down the tunnel a ring lights up in a lane's colour and calls out a note. You answer each call on the matching pad, but *later*: two beats, a bar, two bars, whatever the level's delay is. While you wait, more keys call, so you carry a queue of answers in your head and let them out in order, like a dub delay playing back what the tunnel said. Long calls are holds: press when they reach you, let go when they end. Every answer explodes in its lane's colour, and the explosion echoes back, smaller, on every repeat of the delay.

- **The delay is the game.** The floor calls at beat *b*; you answer at *b + delay*. Nothing else about the timing is hidden: a call is a tail of rings, one a beat from the call to the answer, dimmer each one, so you watch the delay count down as they rush at you, and the last reaches the runner exactly on its due beat, so once you learn the song you can play it by ear with the screen covered.
- **The music tells you when, at first.** In the early levels the call comes round again on its due beat, quieter, through the delay line: you answer on the echo. The pad also takes its lane's colour while its key is in the window. The echo fades level by level and is gone by level five, when you carry the timing yourself.
- **Polyphonic.** With a bar of delay and two calls a bar, two or three answers are always in flight. The dots over the runner's head are the queue you are carrying.
- **A tunnel that rolls.** Lanes are four angles round the tunnel's floor, and the tunnel turns slowly on its axis while the runner stays upright, so the floor turns under you. Its lines weave as they run away, a fainter grid rolls the other way through them, a ring passes every beat (brighter on the bar) and a wave of light runs off ahead of you on each bar.
- **Pass the gate or hit the fence.** Where an answer is due, the wall is open round its lane and a dashed digital fence fills the rest. A right answer goes through the gap; a miss runs into the fence.
- **Colour is the only reward.** The tunnel is near-white on black; only calls, answers and the runner's accents have colour. A hit is a fluid explosion in the lane's colour, white-hot at the core on a perfect: particles that fly out, drag to a drift and smear along their path, while the walls catch the flash. The dub echo re-fires it `delay` beats later, smaller, up to three times, so what you see is what the delay line is doing.
- **Your answers echo.** A right answer plays the note an octave up through a feedback delay set to the level's delay, so it comes back on the beat it would have been due again, darker each pass. Perfect answers are a brighter wave. A press with nothing due on that lane is a thud.
- **Speed is earned.** An answer on time boosts the run (a perfect more than a good), up to two and a half times; a miss or a stray press hits the fence and cuts most of it, and it drifts back to the floor on its own. The charts stay in beats: speed changes how fast the world looks and sounds, never when an answer is due. Going faster opens the filter and brings in sixteenth-note hats; the fence slams the filter shut, drops the hats and turns everything down for half a bar.
- **You can hear the delay count down.** Between a call and its due beat the call's note ticks softly on every beat, quieter each time, so the tail is audible as well as visible.
- **A runner with some swagger.** Drawn in lines and curves, no images: a neon-outlined sprinter in a padded jacket and shades, hair in the wind, who sways while idle, strides on the beat, punches toward a held pad, stumbles after a miss and leans into a boost with a streak behind.
- **Phone first.** Four pads that are each a quarter of the width and a fifth of the height, pointer events with capture so a thumb that slides still releases its hold, no zoom, no scroll, the safe areas respected, a short buzz on hits and a long one on misses. The desktop gets `D` `F` `J` `K` (or the arrow keys) and the same pads.
- **Judged where you heard it.** The press is compared to the beat you heard, not the beat the clock is at: the audio output latency, which on a phone can be 100 ms, is subtracted first.
- **Six levels.** Tempo climbs from 120 to 148 bpm (half-time, so it feels like 60 to 74); the delay is a bar for the first three, then two bars, then an odd six beats. Each level is seeded, so retrying it is the same song.
- **Deep dub, synthesized.** Kick on the one and snare on the three, a bass a bar long whose filter wobbles at a rate the bar picks, a sine sub under it for headphones, a square-wave skank on the offbeats straight into the delay line, and a slow lowpass sweep over everything.

Built with the Web Audio API, a canvas and [Rusty Buns](../../README.md). The wild ideas that haven't landed yet are in [IDEAS.md](IDEAS.md); the owner's direction for it is in [VISION.md](VISION.md).

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
| Pads | the four buttons, or `D` `F` `J` `K`, or the arrow keys |
| Holds | keep the pad down until the long key ends |
| Mute | `M` |
| Quit a run | `Esc` |

**Scoring:** 100 a perfect (within about 43 ms at 140 bpm), 60 a good (within about 107 ms), times a combo multiplier that steps up every ten in a row, up to 4x. A hold is one answer, graded on both ends. A press with nothing due costs 20 and the combo. Eight misses and the song stops.

`src/sim.ts` is the game: charts, the run, the judging, in beats with no DOM. `src/audio.ts` is the loop and the dub delay. `src/hallway.ts` projects the tunnel, the rings and the explosions onto the canvas; `src/runner.ts` draws the runner, a neon-outlined sprinter in a padded jacket and shades who sways, strides, punches toward a held pad, stumbles on a miss and leans into a boost. `src/main.ts` wires them and listens.
