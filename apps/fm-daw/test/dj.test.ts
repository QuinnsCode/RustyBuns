// The DJ decks' arithmetic (src/dj/analyze.ts) on what a DJ does every night: load a track and read its tempo and
// first beat, sync one deck to the other and land on its beat, and throw a loop in (the mixer is test/dj-mixer.test.ts).
// The decks themselves (Web Audio) are driven through /decks.html's harness (qdecks) by the probe.
import { expect, test } from "bun:test";
import { beatPhase, detectGrid, inLoop, loopAt, phaseJump, syncRate } from "../src/dj/analyze.ts";
import { DEMOS, demoTrack } from "../src/dj/demo.ts";

const RATE = 44100;

test("a track's tempo and first downbeat are read from its sound, and silence has no beat", () => {
  const read = DEMOS.map((d) => {
    const g = detectGrid(demoTrack(d, RATE, 30), RATE)!;
    return { name: d.name, bpm: g.bpm, offsetMs: Math.round(Math.abs(g.offset - d.lead) * 1000) <= 20 };
  });
  expect(read).toEqual(DEMOS.map((d) => ({ name: d.name, bpm: d.bpm, offsetMs: true })));
  expect(detectGrid(new Float32Array(RATE * 10), RATE)).toBeNull();
});

test("sync: the 128 deck comes down to 124 and jumps onto the other deck's beat; a loop holds on the grid", () => {
  const a = { bpm: 124, offset: 0.35 }, b = { bpm: 128, offset: 0.2 };
  expect(syncRate(b.bpm, a.bpm * 1)).toBeCloseTo(124 / 128, 6);
  // A is a third of the way through a beat, B two-thirds: B moves the short way, back a third of its beat
  const posA = a.offset + (60 / a.bpm) * (10 + 1 / 3), posB = b.offset + (60 / b.bpm) * (20 + 2 / 3);
  const jump = phaseJump(posB, b, beatPhase(posA, a));
  expect(jump).toBeCloseTo(-(60 / b.bpm) / 3, 6);
  expect(beatPhase(posB + jump, b)).toBeCloseTo(beatPhase(posA, a), 6);
  // a 4-beat loop from the middle of beat 9 starts on beat 9; before the first beat, on the first beat
  const l = loopAt(a.offset + (60 / a.bpm) * 9.5, 4, a);
  expect([l.start, l.end].map((x) => +x.toFixed(4))).toEqual([a.offset + (60 / a.bpm) * 9, a.offset + (60 / a.bpm) * 13].map((x) => +x.toFixed(4)));
  expect(loopAt(0.1, 4, a).start).toBeCloseTo(a.offset, 6);
  // the clock runs past its end: round again from its start
  expect(inLoop(l.end + 0.25, l)).toBeCloseTo(l.start + 0.25, 6);
});
