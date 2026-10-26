# Delayed Reaction

> **What it proves:** a rhythm game that is phone-first: four thumb pads, a synth that runs on the audio clock, presses judged after the output latency comes off, and a sim with no page in it that a test can play through. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

You run along a giant keyboard to a techno loop. Keys light up and call out a note. You answer each call on the matching pad, but *later*: two beats, a bar, two bars, whatever the level's delay is. While you wait, more keys call, so you carry a queue of answers in your head and let them out in order, like a dub delay playing back what the keyboard said. Long keys are holds: press when they reach you, let go when they end.

- **The delay is the game.** The keyboard calls at beat *b*; you answer at *b + delay*. Nothing else about the timing is hidden: the key slides along its rail and reaches the runner exactly on its due beat, so once you learn the song you can play it by ear with the screen covered.
- **Polyphonic.** With a bar of delay and two calls a bar, two or three answers are always in flight. The dots under the rails are the queue you are carrying.
- **Your answers echo.** A right answer plays the note an octave up through a feedback delay set to the level's delay, so it comes back on the beat it would have been due again, darker each pass. Perfect answers are a brighter wave. A press with nothing due on that lane is a thud.
- **Phone first.** Four pads that are each a quarter of the width and a fifth of the height, pointer events with capture so a thumb that slides still releases its hold, no zoom, no scroll, the safe areas respected, a short buzz on hits and a long one on misses. The desktop gets `D` `F` `J` `K` (or the arrow keys) and the same pads.
- **Judged where you heard it.** The press is compared to the beat you heard, not the beat the clock is at: the audio output latency, which on a phone can be 100 ms, is subtracted first.
- **Six levels.** Tempo climbs from 104 to 138 bpm, the delay goes two beats, a bar, two bars, then an odd six beats. Each level is seeded, so retrying it is the same song.

Built with the Web Audio API, a canvas and [Rusty Buns](../../README.md). The wild ideas that didn't make the first cut are in [IDEAS.md](IDEAS.md).

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

**Scoring:** 100 a perfect (within 40 ms at 120 bpm), 60 a good (within 100 ms), times a combo multiplier that steps up every ten in a row, up to 4x. A hold is one answer, graded on both ends. A press with nothing due costs 20 and the combo. Eight misses and the song stops.

`src/sim.ts` is the game: charts, the run, the judging, in beats with no DOM. `src/audio.ts` is the loop and the dub delay. `src/main.ts` draws and listens.
