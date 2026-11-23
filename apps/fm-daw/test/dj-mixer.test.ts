// The decks' four-channel mixer (src/dj/mixer.ts) on what a DJ does with it: kill the bass of the incoming track and
// dip its mids, sweep a filter (high-pass, low-pass, both for a notch) with its resonance up, let the LFO swing it on
// the beat after tapping the tempo, and blend across with the crossfader while a channel on THRU stays put. The face
// and the Web Audio graph run in the page: test/dj-mixer-page.test.ts.
import { expect, test } from "bun:test";
import { bandDb, filterGain, lfoCents, resQ, sweepHz, tapBpm, xfGain, type FilterType } from "../src/dj/mixer.ts";

test("the EQ: every band boosts +6 dB, the high and low cut to a kill, the two mids only to -26", () => {
  const at = (k: number) => (["high", "hiMid", "loMid", "low"] as const).map((b) => Math.round(bandDb(b, k)));
  expect(at(0)).toEqual([0, 0, 0, 0]);
  expect(at(1)).toEqual([6, 6, 6, 6]);
  expect(at(-1)).toEqual([-80, -26, -26, -80]);
  expect(at(-0.5)).toEqual([-15, -13, -13, -15]);
});

test("the filter: each type passes its side of the sweep, high + low is a notch, and the resonance peaks it", () => {
  const f0 = sweepHz(0.5), q = resQ(0), db = (types: FilterType[], hz: number, qq = q) => Math.round(20 * Math.log10(filterGain(types, hz, f0, qq)));
  expect(Math.round(f0)).toBe(632); // the middle of the knob is the middle octave of 20 Hz to 20 kHz
  expect([Math.round(sweepHz(0)), Math.round(sweepHz(1))]).toEqual([20, 20000]);
  const rows: [FilterType[], number, number][] = [
    [["lp"], f0 / 10, 0], [["lp"], f0 * 10, -40],
    [["hp"], f0 * 10, 0], [["hp"], f0 / 10, -40],
    [["bp"], f0, 0], [["bp"], f0 * 10, -24],
    [["hp", "lp"], f0 / 10, 0], [["hp", "lp"], f0 * 10, 0],
    [["hp", "bp", "lp"], f0 * 3, 0],
  ];
  for (const [types, hz, want] of rows) expect([types.join("+"), Math.round(hz), db(types, hz)]).toEqual([types.join("+"), Math.round(hz), want]);
  expect(filterGain(["hp", "lp"], f0, f0, q)).toBeLessThan(1e-9);
  // wild resonance: a whistling peak at the sweep, where mild sits a little under flat
  expect(db(["lp"], f0, resQ(1))).toBe(25);
  expect(db(["lp"], f0)).toBe(-4);
});

test("the LFO swings the sweep on the beat: one round every `beats` beats, depth up to three octaves each way", () => {
  const bpm = tapBpm([0, 500, 1000, 1500])!;
  expect(bpm).toBe(120);
  expect(tapBpm([0, 500, 4000, 4480])).toBe(125); // a long gap starts the count again
  expect(tapBpm([10])).toBeNull();
  const beat = 60 / bpm;
  expect(lfoCents(0, bpm, 4, 1)).toBeCloseTo(0, 6);
  expect(lfoCents(beat, bpm, 4, 1)).toBeCloseTo(3600, 6); // a quarter of a 4-beat round: the top, three octaves up
  expect(lfoCents(3 * beat, bpm, 4, 0.5)).toBeCloseTo(-1800, 6);
  expect(lfoCents(4 * beat, bpm, 4, 1)).toBeCloseTo(0, 6);
  expect(lfoCents(beat, bpm, 4, 0)).toBe(0);
});

test("the crossfader: X is its left, Y its right, THRU ignores it; the curve blends at constant power or cuts", () => {
  for (const x of [-1, -0.4, 0, 0.7, 1]) {
    const a = xfGain("x", x, "smooth"), b = xfGain("y", x, "smooth");
    expect(a * a + b * b).toBeCloseTo(1, 6);
    expect(xfGain("off", x, "smooth")).toBe(1);
  }
  expect([xfGain("x", -1, "smooth"), xfGain("y", -1, "smooth")].map((g) => +g.toFixed(3))).toEqual([1, 0]);
  expect([xfGain("x", 0, "cut"), xfGain("y", 0, "cut"), xfGain("x", 1, "cut")]).toEqual([1, 1, 0]);
});
