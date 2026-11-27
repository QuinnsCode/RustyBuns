// Q Instruments' lesson (#6172), walked as a beginner does it on the decks' own state (engine.ts's DeckState as the
// demo tracks give it, mixer.ts's crossfader, assigns, faders and cues): both demo tracks loaded, A playing, B at its
// own tempo first, then started where the room hears it, then off the beat, each read back with why, put right, and
// the crossfader across with the lesson done.
import { expect, test } from "bun:test";
import { DEMOS } from "../src/dj/demo.ts";
import { decksNow, MIX_LESSON, watchDecks, type DecksAt } from "../src/dj/lesson.ts";
import type { XAssign } from "../src/dj/mixer.ts";
import { PageLesson } from "../src/studio/page-lesson.ts";

test("Q Instruments: mix 124 into 128, B at its own tempo, started on the floor, then off the beat, then across", () => {
  const [A, B] = DEMOS;
  // each deck: its track's grid, a tempo fader (a rate), and a clock that moves it on while it plays
  const deck = (d: typeof A) => ({ name: d!.name, playing: false, pos: 0, rate: 1, grid: { bpm: d!.bpm, offset: d!.lead } });
  const a = deck(A), b = deck(B);
  const ch = (xf: XAssign) => ({ cue: false, fader: 0.8, xf });
  const mixer = { channels: [ch("off"), ch("x"), ch("y"), ch("off")], xfader: 0, curve: "smooth" as const };
  const at = (d: typeof a) => ({ ...d, bpm: Math.round(d.grid.bpm * d.rate * 10) / 10 });
  const run = (s: number) => { for (const d of [a, b]) if (d.playing) d.pos += s * d.rate; };
  /** B moved the shortest way onto A's beat, as the jog does it by ear. */
  const align = () => { const d = ((a.pos - A!.lead) * A!.bpm) / 60 - ((b.pos - B!.lead) * B!.bpm) / 60; b.pos += (d - Math.round(d)) * (60 / B!.bpm); };
  const watch = watchDecks();
  const lesson = new PageLesson<DecksAt>(MIX_LESSON, () => watch(decksNow({ decks: [at(a), at(b)], ...mixer })));
  lesson.start();
  const now = () => lesson.state()!;

  // both demo tracks are on; A plays, the crossfader still in the middle
  expect(now()).toMatchObject({ id: "mix", next: 1 });
  a.playing = true; a.pos = 8;
  expect(now()).toMatchObject({ next: 2 });
  expect(now().steps[2].why).toBe("B runs at 128 BPM and A at 124: B pulls ahead of A by a whole beat every 15 s, so two kicks gallop. Move B's tempo fader down 3.1 %, or press SYNC");
  b.rate = 124 / 128;
  expect(now()).toMatchObject({ next: 3 });

  // B started with the crossfader in the middle: the room heard it
  b.playing = true;
  expect(now().steps[3].why).toMatch(/^B started where the room could hear it/);
  b.playing = false; now(); // the card sees B stop
  mixer.xfader = -1; mixer.channels[2]!.cue = true;
  // now in the headphones, but a third of a beat late
  align(); b.pos -= 60 / B!.bpm / 3;
  b.playing = true;
  expect(now().steps[3].why).toMatch(/^B's kick lands 1\d\d ms after A's: it started off the beat, or drifted/);
  expect(now()).toMatchObject({ next: 3 });

  // the jog: B moved onto A's beat, then both run on for half a minute and stay in step
  align();
  expect(now()).toMatchObject({ next: 4 });
  run(30);
  expect(now()).toMatchObject({ next: 4 });

  // across: halfway the room hears both, and the steps before stay done
  mixer.xfader = 0;
  expect(now()).toMatchObject({ next: 4 });
  mixer.xfader = 1;
  expect(now()).toMatchObject({ done: true });
  a.playing = false; run(20);
  expect(now()).toMatchObject({ done: true });
  expect(lesson.finished).toBe(true);
});
