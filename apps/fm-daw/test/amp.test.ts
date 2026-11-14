// Q Amp's live chain (src/amp/live.ts, what the audio thread runs): play the riff
// in 128-sample blocks while someone works the front panel, the way the page does.
import { expect, setDefaultTimeout, test } from "bun:test";
import { AMPS } from "../src/circuit/amps.ts";
import { riff } from "../src/circuit/riff.ts";
import { FULL_SCALE, applySettings, limit, type Live } from "../src/amp/live.ts";
import type { AmpSettings } from "../src/amp/messages.ts";

setDefaultTimeout(60_000);
const SR = 48000, BLOCK = 128;

test("working the knobs while the riff plays: rebuilds only what moved, never past -1 dBFS", () => {
  const dry = riff(SR);
  let s: AmpSettings = { amp: "lead", pedal: null, drive: 3, knobs: { ...AMPS[1].knobs }, bypass: false, oversample: 4 };
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
    ["Q Fuzz on", { pedal: "fuzz" }, true],
    ["Q Drive instead", { pedal: "drive" }, true],
    ["its Drive up", { drive: 10 }, false],
    ["Q Triple", { amp: "triple", knobs: { ...AMPS[2].knobs } }, true],
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

test("the Noise knob: silent at 0, a hiss through the tubes at 7", () => {
  const quiet = new Float32Array(SR / 2), out = new Float32Array(quiet.length);
  const floor = (noise: number) => {
    const live = applySettings({ amp: "lead", pedal: null, drive: 0, knobs: { ...AMPS[1].knobs, noise }, bypass: false, oversample: 4 }, null, SR);
    live.rig.process(quiet, out);
    let ss = 0;
    for (let i = quiet.length / 2; i < quiet.length; i++) ss += (out[i] / FULL_SCALE) ** 2;
    return Math.sqrt(ss / (quiet.length / 2));
  };
  expect(floor(0)).toBeLessThan(1e-6);
  expect(floor(7)).toBeGreaterThan(0.01); // louder than −40 dBFS
});
