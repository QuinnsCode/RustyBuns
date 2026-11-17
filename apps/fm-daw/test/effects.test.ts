// Q Amp's circuit effects (ANALOG.md section 3): each pedal on the floor does what
// its circuit should (notches sweep, the wah's peak follows the treadle, the octave
// doubles the pitch, the compressor squeezes), plays into an amp on the riff without
// the solver giving up, and turns its knob live.
import { expect, setDefaultTimeout, test } from "bun:test";
import { AMPS, PEDALS, buildRig, type PedalDef } from "../src/circuit/amps.ts";
import { Circuit, encodeNetlist, runRig } from "@rustybuns/gear/circuit";
import { riff } from "../src/circuit/riff.ts";
import { applySettings } from "../src/amp/live.ts";
import type { AmpSettings } from "../src/amp/messages.ts";

setDefaultTimeout(60_000);
const SR = 48000;
const sine = (hz: number, seconds: number, amp = 1) => Float32Array.from({ length: SR * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const pedal = (id: string): PedalDef => {
  const p = PEDALS.find((x) => x.id === id);
  if (!p) throw new Error(`no pedal ${id}`);
  return p;
};
/** The pedal alone into a clean desk. */
const alone = (id: string, k: number, input: Float32Array) => {
  const p = pedal(id);
  return runRig({ inputVolts: 0.5, links: [{ net: p.net(k), mods: p.mods?.(k) }], power: 0, cab: null }, input);
};
const rms = (b: Float32Array, from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += b[i] * b[i]; return Math.sqrt(s / (to - from)); };
/** Loudest over quietest 25 ms window after the first 0.1 s: how deep a modulation goes. */
const swing = (b: Float32Array) => {
  const w = SR / 40, r: number[] = [];
  for (let i = SR / 10; i + w <= b.length; i += w) r.push(rms(b, i, i + w));
  return Math.max(...r) / Math.min(...r);
};
/** Gain at `hz` through a circuit (its controls as they are), on the second half of 0.2 s. */
const gainAt = (c: Circuit, hz: number, amp = 0.05) => {
  const rest = c.settle(0), n = 192000 * 0.2;
  let pk = 0;
  for (let i = 0; i < n; i++) { const y = c.step(amp * Math.sin((2 * Math.PI * hz * i) / 192000)) - rest; if (i > n / 2) pk = Math.max(pk, Math.abs(y)); }
  return pk / amp;
};

test("each effect does what its circuit does", () => {
  // The moving ones: the level (or the notches across a steady note) rises and falls.
  for (const [id, k, min] of [["phase", 5, 1.5], ["vibe", 5, 1.5], ["trem", 5, 3]] as const) {
    const run = alone(id, k, sine(440, 1));
    expect([id, run.misses, swing(run.out) > min]).toEqual([id, 0, true]);
  }
  // The wah's peak: low at the heel, high at the toe.
  const heel = new Circuit(pedal("wah").net(0), 192000), toe = new Circuit(pedal("wah").net(10), 192000);
  expect(gainAt(heel, 550) > 2 * gainAt(heel, 1800)).toBe(true);
  expect(gainAt(toe, 1800) > 2 * gainAt(toe, 550)).toBe(true);
  // Octave up: a 110 Hz note comes out with twice the zero crossings.
  const oct = alone("octave", 6, sine(110, 0.5)).out;
  let mean = 0;
  for (let i = SR / 10; i < oct.length; i++) mean += oct[i] / (oct.length - SR / 10);
  let crossings = 0;
  for (let i = SR / 10 + 1; i < oct.length; i++) if ((oct[i - 1] - mean) * (oct[i] - mean) < 0) crossings++;
  expect(Math.round(crossings / (0.4 * 110 * 2))).toBe(2);
  // The compressor: 20 dB more in comes out under 10 dB more.
  const loud = alone("comp", 5, sine(220, 1, 1)), quiet = alone("comp", 5, sine(220, 1, 0.1));
  expect(20 * Math.log10(rms(loud.out, SR / 2, SR) / rms(quiet.out, SR / 2, SR))).toBeLessThan(10);
  // The envelope wah: playing hard pushes the treadle toward the toe (more 1.8 kHz for the same note).
  const hard = alone("autowah", 7, sine(1800, 0.5, 1)), soft = alone("autowah", 7, sine(1800, 0.5, 0.05));
  expect(rms(hard.out, SR / 4, SR / 2) / rms(soft.out, SR / 4, SR / 2)).toBeGreaterThan(2 * 20);
  // Germanium: a warm room moves the second transistor's bias by volts.
  const bias = (k: number) => { const c = new Circuit(pedal("germ").net(k), 192000); c.settle(0); return c.volts("Q2_C"); };
  expect(Math.abs(bias(10) - bias(0))).toBeGreaterThan(1);
});

test("each board plays as the hand-written netlist it replaced (#4952)", () => {
  // RMS out on a quarter second of the riff, the pedal alone at knob k, from the old netlists: the boards matched them sample for sample.
  const input = riff(SR).subarray(0, SR / 4);
  const table = [
    ["phase", 5, 0.0915985], ["vibe", 5, 0.124341], ["trem", 5, 0.0479829], ["wah", 0, 0.0137797], ["wah", 10, 0.058091],
    ["autowah", 7, 0.049804], ["comp", 5, 0.80849], ["octave", 6, 0.083778], ["germ", 0, 0.14558], ["germ", 10, 0.239098],
  ] as const;
  for (const [id, k, want] of table) {
    const out = alone(id, k, input).out;
    expect([id, k, Number(rms(out, 0, out.length).toPrecision(5))]).toEqual([id, k, Number(want.toPrecision(5))]);
  }
});

test("every effect into the lead amp on the riff: converged and bounded, its knob turning live", () => {
  const lead = AMPS[1], input = riff(SR).subarray(0, SR / 2);
  for (const p of PEDALS) {
    const run = runRig(buildRig(lead, lead.knobs, { def: p, drive: 5 }), input);
    let top = 0;
    for (const v of run.out) top = Math.max(top, Number.isFinite(v) ? Math.abs(v) : Infinity);
    expect([p.id, run.misses, top > 0.01 && top < 200]).toEqual([p.id, 0, true]);
  }
  // Turning Rate rebuilds the phaser's link (the LFO keeps its phase) and keeps playing.
  const s: AmpSettings = { amp: "lead", pedal: "phase", drive: 3, knobs: lead.knobs, bypass: false, oversample: 4, swaps: {}, mic: { at: 0.3, angle: 0 } };
  const live = applySettings(s, null, SR), out = new Float32Array(SR / 10);
  live.rig.process(input, out, out.length);
  const next = applySettings({ ...s, drive: 8 }, live, SR);
  expect(next.rig).toBe(live.rig);
  expect(next.keys[0]).not.toBe(live.keys[0]);
  next.rig.process(input, out, out.length);
  expect(out.every(Number.isFinite)).toBe(true);
});

test("an expression pedal's CC sweep rocks the wah from heel to toe and never rebuilds it", () => {
  const lead = AMPS[1], tone = (hz: number) => sine(hz, 0.15, 0.05);
  const s: AmpSettings = { amp: "lead", pedal: "wah", drive: 0, knobs: { ...lead.knobs, gain: 1 }, bypass: false, oversample: 2, swaps: {}, mic: { at: 0.3, angle: 0 } };
  const live = applySettings(s, null, SR), out = new Float32Array(tone(0).length);
  /** How much louder 1.8 kHz comes out than 570 Hz, the treadle where CC `cc` put it. */
  const tilt = (cc: number) => {
    const next = applySettings({ ...s, drive: (cc / 127) * 10 }, live, SR);
    expect([cc, next.rig === live.rig, next.keys.join() === live.keys.join()]).toEqual([cc, true, true]);
    const level = (hz: number) => { next.rig.process(tone(hz), out); return rms(out, out.length / 2, out.length); };
    return level(1800) / level(570);
  };
  for (let cc = 0; cc <= 127; cc += 8) applySettings({ ...s, drive: (cc / 127) * 10 }, live, SR);
  const heel = tilt(0), toe = tilt(127);
  expect(heel).toBeLessThan(1);
  expect(toe / heel).toBeGreaterThan(4);
  // The pedal's own peak, turned the way the rig turns it (a `setPot` on one circuit): ~570 Hz to ~1.8 kHz.
  const c = new Circuit(pedal("wah").net(0), 192000), hzs = Array.from({ length: 25 }, (_, i) => 400 * 2 ** (i / 10));
  const peak = (at: number) => { c.setPot(0, at); const g = hzs.map((hz) => gainAt(c, hz)); return hzs[g.indexOf(Math.max(...g))]; };
  expect(peak(1)).toBeGreaterThan(450);
  expect(peak(1)).toBeLessThan(700);
  expect(peak(0)).toBeGreaterThan(1500);
  expect(peak(0)).toBeLessThan(2200);
});

test("the Rust solver says which part it doesn't have yet", () => {
  expect(() => encodeNetlist(pedal("trem").net(4))).toThrow("the Rust solver has no VarR yet");
  expect(encodeNetlist(pedal("germ").net(4)).length).toBeGreaterThan(4); // transistors are in Rust (#4826)
  expect(() => encodeNetlist(pedal("phase").net(4))).toThrow("rail-less op-amp");
});
