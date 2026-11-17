// The stage line: guitar -> DI -> XLR -> console channel. A thru to the amp makes a ground
// loop that hums; the DI's lift clears it; the channel's EQ and fader work on what is left.
import { expect, setDefaultTimeout, test } from "bun:test";
import { ConsoleChannel, lineCheck } from "../src/circuit/stage.ts";
import { flatEq } from "../src/engine/eq.ts";

setDefaultTimeout(60_000);
const SR = 48000;
const rms = (b: Float32Array, from: number) => {
  let s = 0;
  for (let i = from; i < b.length; i++) s += b[i] * b[i];
  return Math.sqrt(s / (b.length - from));
};

test.each([
  { what: "DI to the desk alone: no loop", thru: false, lift: false, clear: [120, Infinity] },
  { what: "thru to the amp too: it hums", thru: true, lift: false, clear: [25, 50] },
  { what: "thru to the amp, ground lifted", thru: true, lift: true, clear: [80, Infinity] },
])("line check: $what", ({ thru, lift, clear: [lo, hi] }) => {
  const got = lineCheck({ thru, lift });
  // A 200 mV note, doubled by the DI and lifted by the preamp, reaches the desk at a couple of volts either way.
  expect(got.signal).toBeGreaterThan(5);
  expect(got.signal).toBeLessThan(12);
  expect(got.clear).toBeGreaterThan(lo);
  expect(got.clear).toBeLessThan(hi);
});

test("a channel plays the note, hums in the gap until the DI is lifted, and its EQ and fader work", () => {
  // Half a second of a note, then half a second of the guitar muted: what the roadie hears in the gap is hum.
  const take = Float32Array.from({ length: SR }, (_, i) => (i < SR / 2 ? 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR) : 0));
  const play = (lift: boolean, set?: (c: ConsoleChannel) => void) => {
    const c = new ConsoleChannel(SR, { thru: true, lift });
    set?.(c);
    const out = c.process(take);
    return { note: rms(out.subarray(0, SR / 2), SR / 4), gap: rms(out, (SR * 3) / 4) };
  };
  const loop = play(false), lifted = play(true);
  expect(loop.note).toBeGreaterThan(1);
  expect(lifted.note).toBeCloseTo(loop.note, 1);
  expect(loop.gap).toBeGreaterThan(0.01);
  expect(lifted.gap).toBeLessThan(loop.gap / 10); // what is left is the note dying away through the DI's input cap

  // A low cut at 150 Hz takes most of the 60 Hz hum out of the gap; the fader all the way down is silence.
  const cut = flatEq();
  cut[0] = { kind: "lowCut", f: 150, g: 0, q: 0.7, slope: 24, on: true };
  expect(play(false, (c) => c.setEq(cut)).gap).toBeLessThan(loop.gap / 10);
  expect(play(false, (c) => { c.fader = -Infinity; }).note).toBe(0);
});
