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

test("the effects loop: machines switched and turned while the riff plays, then their tails ring on in the silence", () => {
  const dry = riff(SR);
  let s: AmpSettings = { amp: "brit", pedal: null, drive: 0, knobs: { ...AMPS[0].knobs, noise: 0 }, bypass: false, oversample: 4 };
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
    const live = applySettings({ amp: "lead", pedal: null, drive: 0, knobs: { ...AMPS[1].knobs, noise }, bypass: false, oversample: 4 }, null, SR);
    live.rig.process(quiet, out);
    let ss = 0;
    for (let i = quiet.length / 2; i < quiet.length; i++) ss += (out[i] / FULL_SCALE) ** 2;
    return Math.sqrt(ss / (quiet.length / 2));
  };
  expect(floor(0)).toBeLessThan(1e-6);
  expect(floor(7)).toBeGreaterThan(0.01); // louder than −40 dBFS
});
