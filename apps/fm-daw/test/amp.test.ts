// Q Amp's live chain (src/amp/live.ts, what the audio thread runs): play the riff
// in 128-sample blocks while someone works the front panel and the pedalboard, the way the page does.
import { expect, setDefaultTimeout, test } from "bun:test";
import { AMPS } from "../src/circuit/amps.ts";
import { riff } from "../src/circuit/riff.ts";
import { FULL_SCALE, applySettings, limit } from "../src/amp/live.ts";
import type { Board } from "../src/amp/board.ts";
import { AMP_SLOT, freshBoard, tidyBoard, type Slot } from "../src/amp/slots.ts";
import type { AmpSettings } from "../src/amp/messages.ts";

setDefaultTimeout(60_000);
const SR = 48000, BLOCK = 128;

/** The board with these effects switched on, in this order around the amp's slot. */
const boardOf = (...ids: string[]): Slot[] => tidyBoard(ids.map((id) => ({ id, on: true, knob: id === "space" ? 6 : 5 })));

test("a player builds a board while the riff plays: reorders, the loop, stereo, a load per slot, never past -1 dBFS", () => {
  const dry = riff(SR);
  let s: AmpSettings = { amp: "lead", knobs: { ...AMPS[1].knobs }, board: freshBoard(), bypass: false, oversample: 4 };
  let board: Board = applySettings(s, null, SR);
  let at = 0, peak = 0, sideDiff = 0;
  const left = new Float32Array(BLOCK), right = new Float32Array(BLOCK);
  const play = (blocks: number) => {
    for (let b = 0; b < blocks; b++, at = (at + BLOCK) % (dry.length - BLOCK)) {
      board.process(dry.subarray(at, at + BLOCK), left, right, BLOCK);
      for (let i = 0; i < BLOCK; i++) {
        const l = limit(left[i] / FULL_SCALE), r = limit(right[i] / FULL_SCALE);
        peak = Math.max(peak, Math.abs(l), Math.abs(r));
        sideDiff = Math.max(sideDiff, Math.abs(l - r));
      }
    }
  };
  // A stage's key is "pedal:fuzz:4:false", "tubes:lead:4:false" and so on: the effect's id, or which part of the amp.
  const order = () => board.chain.split(" > ").map((k) => { const [kind, id] = k.split(":"); return kind === "pedal" || kind === "space" ? id : kind; });
  play(40);
  expect(order()).toEqual(["tubes", "tone", "power"]);

  // Each move: the board it makes, the chain it should run, whether it ends stereo.
  const moves: [string, Partial<AmpSettings>, string[], boolean][] = [
    ["Q Drive then Q Fuzz", { board: boardOf("drive", "fuzz", AMP_SLOT) }, ["drive", "fuzz", "tubes", "tone", "power"], false],
    ["swapped: Q Fuzz then Q Drive", { board: boardOf("fuzz", "drive", AMP_SLOT) }, ["fuzz", "drive", "tubes", "tone", "power"], false],
    ["Q Space in the loop", { board: boardOf("fuzz", "drive", AMP_SLOT, "space") }, ["fuzz", "drive", "tubes", "tone", "space", "power"], true],
    ["gain up", { knobs: { ...s.knobs, gain: 10 } }, ["fuzz", "drive", "tubes", "tone", "space", "power"], true],
    ["Q Space in front: the amp runs twice", { board: boardOf("space", "fuzz", AMP_SLOT) }, ["space", "fuzz", "tubes", "tone", "power"], true],
    ["Eco", { oversample: 2 }, ["space", "fuzz", "tubes", "tone", "power"], true],
  ];
  for (const [what, change, chain, stereo] of moves) {
    s = { ...s, ...change };
    board = applySettings(s, board, SR);
    play(60);
    expect([what, order(), board.stereo, board.misses]).toEqual([what, chain, stereo, 0]);
    // Every slot that ran has its time.
    const times = board.times();
    expect([what, times.map((t) => t.id).sort()]).toEqual([what, [...new Set(chain.map((c) => (["tubes", "tone", "power"].includes(c) ? AMP_SLOT : c)))].sort()]);
  }
  expect(peak).toBeGreaterThan(0.3);
  expect(peak).toBeLessThanOrEqual(0.89);
  expect(sideDiff).toBeGreaterThan(0.01); // Q Space made the two sides differ
  expect(limit(Number.NaN)).toBe(0);
});

test("a saved board with an effect missing or doubled comes back whole, the amp switched on", () => {
  const back = tidyBoard([{ id: "space", on: true, knob: 3 }, { id: AMP_SLOT, on: false, knob: 0 }, { id: "space", on: false, knob: 9 }, { id: "gone", on: true, knob: 1 }]);
  expect(back.map((b) => b.id)).toEqual(["drive", "fuzz", "dist", "space", AMP_SLOT]);
  expect(back.find((b) => b.id === "space")).toEqual({ id: "space", on: true, knob: 3 });
  expect(back.find((b) => b.id === AMP_SLOT)?.on).toBe(true);
});

test("the Noise knob: silent at 0, a hiss through the tubes at 7", () => {
  const quiet = new Float32Array(SR / 2), l = new Float32Array(quiet.length), r = new Float32Array(quiet.length);
  const floor = (noise: number) => {
    const board = applySettings({ amp: "lead", knobs: { ...AMPS[1].knobs, noise }, board: freshBoard(), bypass: false, oversample: 4 }, null, SR);
    board.process(quiet, l, r);
    let ss = 0;
    for (let i = quiet.length / 2; i < quiet.length; i++) ss += (l[i] / FULL_SCALE) ** 2;
    return Math.sqrt(ss / (quiet.length / 2));
  };
  expect(floor(0)).toBeLessThan(1e-6);
  expect(floor(7)).toBeGreaterThan(0.01); // louder than −40 dBFS
});
