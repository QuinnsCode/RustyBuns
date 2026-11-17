// Q Amp's live chain (src/amp/live.ts, what the audio thread runs): play the riff
// in 128-sample blocks while someone works the front panel, the way the page does.
import { expect, setDefaultTimeout, test } from "bun:test";
import { AMPS } from "../src/circuit/amps.ts";
import { riff } from "../src/circuit/riff.ts";
import { cutPoints, planCuts } from "@rustybuns/gear/circuit";
import { FULL_SCALE, applySettings, limit, rigSpec, type Live } from "../src/amp/live.ts";
import type { AmpSettings, ToPart } from "../src/amp/messages.ts";
import { Head, Ring } from "../src/amp/ring.ts";
import { partsFor } from "../src/amp/threads.ts";

setDefaultTimeout(60_000);
const SR = 48000, BLOCK = 128;

test("working the knobs while the riff plays: rebuilds only what moved, never past -1 dBFS", () => {
  const dry = riff(SR);
  let s: AmpSettings = { amp: "lead", pedal: null, drive: 3, knobs: { ...AMPS[1].knobs }, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 } };
  let live: Live = applySettings(s, null, SR);
  let at = 0, peak = 0;
  const out = new Float32Array(BLOCK);
  const play = (blocks: number) => {
    for (let b = 0; b < blocks; b++, at = (at + BLOCK) % (dry.length - BLOCK)) {
      live.rig.process(dry.subarray(at, at + BLOCK), out, BLOCK);
      for (const v of out) peak = Math.max(peak, Math.abs(limit(v / FULL_SCALE)));
    }
  };
  // Each move, and whether it should build a whole new chain.
  const moves: [string, Partial<AmpSettings>, boolean][] = [
    ["gain up", { knobs: { ...s.knobs, gain: 10 } }, false],
    ["treble down", { knobs: { ...s.knobs, gain: 10, treble: 1 } }, false],
    ["master up", { knobs: { ...s.knobs, gain: 10, treble: 1, master: 10 } }, false],
    ["noise up", { knobs: { ...s.knobs, gain: 10, treble: 1, master: 10, noise: 8 } }, false],
    ["mic to the edge, off axis", { mic: { at: 1, angle: 60 } }, false],
    ["Q Fuzz on", { pedal: "fuzz" }, true],
    ["Q Drive instead", { pedal: "drive" }, true],
    ["its Drive up", { drive: 10 }, false],
    ["germanium in its clipper socket", { swaps: { D1: "germanium" } }, false],
    ["Q Triple", { amp: "triple", knobs: { ...AMPS[2].knobs } }, true],
    ["Q Clean T", { amp: "clean", knobs: { ...AMPS[3].knobs } }, true],
    ["its trem faster and deeper", { knobs: { ...AMPS[3].knobs, rate: 9, depth: 10 } }, false],
    ["Eco", { oversample: 2 }, true],
    ["Q Dist instead", { pedal: "dist" }, true],
  ];
  play(40);
  for (const [what, change, fresh] of moves) {
    const before = live.rig;
    s = { ...s, ...change };
    live = applySettings(s, live, SR);
    expect([what, live.rig !== before]).toEqual([what, fresh]);
    play(40);
    expect([what, live.rig.misses]).toEqual([what, 0]);
  }
  expect(live.rig.oversample).toBe(2);
  expect(peak).toBeGreaterThan(0.3);
  expect(peak).toBeLessThanOrEqual(0.89);
  expect(limit(Number.NaN)).toBe(0);
});

test("the effects loop: machines switched and turned while the riff plays, then their tails ring on in the silence", () => {
  const dry = riff(SR);
  let s: AmpSettings = { amp: "brit", pedal: null, drive: 0, knobs: { ...AMPS[0].knobs, noise: 0 }, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 } };
  let live: Live = applySettings(s, null, SR);
  const amp = live.rig;
  const out = new Float32Array(BLOCK), quiet = new Float32Array(BLOCK);
  let at = 0, peak = 0;
  const play = (blocks: number, src = dry) => {
    let ss = 0;
    for (let b = 0; b < blocks; b++, at = (at + BLOCK) % (dry.length - BLOCK)) {
      live.rig.process(src === dry ? dry.subarray(at, at + BLOCK) : quiet, out, BLOCK);
      for (const v of out) { const y = limit(v / FULL_SCALE); peak = Math.max(peak, Math.abs(y)); ss += y * y; }
    }
    return Math.sqrt(ss / (blocks * BLOCK));
  };
  const tail = () => { play(10, quiet); return play(60, quiet); }; // skip the amp's own ring-down, then listen
  play(100);
  const ampTail = tail();
  const moves: [string, AmpSettings["loop"]][] = [
    ["spring on", [{ kind: "spring", dwell: 5, mix: 6 }]],
    ["tape in front of it", [{ kind: "tape", time: 3, repeats: 5, mix: 5, heads: [1, 3] }, { kind: "spring", dwell: 5, mix: 6 }]],
    ["Time turned while it echoes", [{ kind: "tape", time: 8, repeats: 5, mix: 5, heads: [1, 3] }, { kind: "spring", dwell: 10, mix: 6 }]],
    ["chorus first", [{ kind: "bbd", mode: "chorus", rate: 4, depth: 6 }, { kind: "tape", time: 8, repeats: 5, mix: 5, heads: [1, 3] }, { kind: "spring", dwell: 10, mix: 6 }]],
    ["tape off", [{ kind: "bbd", mode: "flanger", rate: 4, depth: 6 }, { kind: "spring", dwell: 10, mix: 6 }]],
  ];
  for (const [what, loop] of moves) {
    s = { ...s, loop };
    live = applySettings(s, live, SR);
    expect([what, live.rig === amp]).toEqual([what, true]); // the tubes are never rebuilt for the loop
    play(100);
    expect([what, live.rig.misses]).toEqual([what, 0]);
    expect([what, tail() > 10 * ampTail]).toEqual([what, true]);
  }
  expect(peak).toBeLessThanOrEqual(0.89);
  // All off: back to the dry amp's own silence.
  live = applySettings({ ...s, loop: [] }, live, SR);
  play(20);
  expect(tail()).toBeLessThan(2 * ampTail + 1e-6);
});

test("the Noise knob: silent at 0, a hiss through the tubes at 7", () => {
  const quiet = new Float32Array(SR / 2), out = new Float32Array(quiet.length);
  const floor = (noise: number) => {
    const live = applySettings({ amp: "lead", pedal: null, drive: 0, knobs: { ...AMPS[1].knobs, noise }, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 } }, null, SR);
    live.rig.process(quiet, out);
    let ss = 0;
    for (let i = quiet.length / 2; i < quiet.length; i++) ss += (out[i] / FULL_SCALE) ** 2;
    return Math.sqrt(ss / (quiet.length / 2));
  };
  expect(floor(0)).toBeLessThan(1e-6);
  expect(floor(7)).toBeGreaterThan(0.01); // louder than −40 dBFS
});

test("a board over one thread's budget, split across workers: the one-thread sound, a block later per hop", async () => {
  const dry = riff(SR);
  // Q Drive and Q Fuzz into Q Lead 50 with the spring in its loop, 4×: over budget on one thread (#4948).
  const board: AmpSettings = { amp: "lead", pedal: null, drive: 0, knobs: { ...AMPS[1].knobs }, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 }, board: [{ pedal: "drive", drive: 5 }, { pedal: "fuzz", drive: 7 }], loop: [{ kind: "spring", dwell: 5, mix: 6 }] };
  const turned: AmpSettings = { ...board, knobs: { ...board.knobs, gain: 9 }, board: [{ pedal: "drive", drive: 8 }, { pedal: "fuzz", drive: 7 }] };
  const BLOCKS = 120, TURN = 60;
  const block = (b: number) => dry.subarray(b * BLOCK, b * BLOCK + BLOCK);

  // One thread: the reference, and each slot's work to cut by.
  let one = applySettings(board, null, SR);
  const ref: Float32Array[] = [];
  for (let b = 0; b < BLOCKS; b++) {
    if (b === TURN) one = applySettings(turned, one, SR);
    const out = new Float32Array(BLOCK);
    one.rig.process(block(b), out, BLOCK);
    ref.push(out);
  }
  const measured = applySettings(board, null, SR).rig;
  measured.process(dry.subarray(0, 48 * BLOCK), new Float32Array(48 * BLOCK));
  const slots = measured.work(), total = slots.reduce((a, x) => a + x, 0);

  for (const parts of [2, 3]) {
    const cuts = planCuts(slots, parts, cutPoints(rigSpec(board).spec));
    expect(cuts.length).toBe(parts - 1);
    // The busiest part does well under the whole chain's work.
    const edges = [0, ...cuts, slots.length - 1];
    const shares = edges.slice(1).map((e, k) => slots.slice(edges[k], k === parts - 1 ? slots.length : e).reduce((a, x) => a + x, 0) / total);
    expect(Math.max(...shares)).toBeLessThan(parts === 2 ? 0.75 : 0.55);

    const rings = Array.from({ length: parts }, () => Ring.make().sab);
    const workers = cuts.map((_, i) => {
      const w = new Worker(new URL("../src/amp/part-worker.ts", import.meta.url).href);
      const start: ToPart = { t: "start", rings, index: i + 1, sampleRate: SR };
      w.postMessage(start);
      return w;
    });
    const head = new Head(SR);
    head.connect(rings);
    const play = (settings: AmpSettings, v: number) => {
      const m: ToPart = { t: "set", settings, v, cuts };
      head.set(m);
      for (const w of workers) w.postMessage(m);
    };
    play(board, 1);
    const out = new Float32Array(BLOCK);
    const heard: Float32Array[] = [];
    try {
      for (let b = 0; b < BLOCKS + cuts.length; b++) {
        if (b === TURN) play(turned, 2); // a knob and a pedal's Drive mid-riff: every part changes on the same block
        expect(head.block(b < BLOCKS ? block(b) : new Float32Array(BLOCK), out, BLOCK, 5000)).toBe(true);
        heard.push(out.slice());
      }
    } finally {
      for (const w of workers) w.terminate();
    }
    expect([parts, head.hops, head.late]).toEqual([parts, cuts.length, 0]);
    for (let b = 0; b < cuts.length; b++) expect(heard[b].every((x) => x === 0)).toBe(true);
    for (let b = 0; b < BLOCKS; b++) expect([parts, b, Array.from(heard[b + cuts.length])]).toEqual([parts, b, Array.from(ref[b])]);
  }
  expect(partsFor(0.5)).toBe(1);
  expect(partsFor(1.28)).toBe(3);
});
