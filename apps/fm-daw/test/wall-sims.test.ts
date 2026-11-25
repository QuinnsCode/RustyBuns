// The sound wall's modules as sound (WALL.md): each module's board doing what its panel says, then a patch of them
// (the sequencer into the VCO, the filter and the VCA, the envelope on the VCA, the mixer into Q Out) playing the
// sequencer's notes, and a mixer send through a spring and back into its return changing the mix.
import { expect, setDefaultTimeout, test } from "bun:test";
import { DEFAULT_ROOM } from "../src/circuit/amps.ts";
import type { AmpSettings } from "../src/amp/messages.ts";
import { renderWall, type WallSpec } from "../src/wall/wall.ts";
import { Linear, makeSim } from "../src/wall/sims.ts";

setDefaultTimeout(30_000);

/** `seconds` of one module, its inputs from `drive(t)`: every output's peak over the last half, and ten samples of each. */
function run(kind: string, knobs: Record<string, number>, drive: (t: number) => number[], seconds = 0.2, sampleRate = 48000) {
  const sim = makeSim(kind, sampleRate, knobs), x = new Float64Array(sim.ins.length), y = new Float64Array(sim.outs.length);
  const n = Math.round(seconds * sampleRate), peak = sim.outs.map(() => 0), trace: number[][] = sim.outs.map(() => []);
  for (let i = 0; i < n; i++) {
    x.set(drive(i / sampleRate));
    sim.step(x, y);
    if (i >= n / 2) y.forEach((v, o) => { peak[o] = Math.max(peak[o], Math.abs(v)); });
    if (i % (n / 10) === 0) y.forEach((v, o) => trace[o].push(v));
  }
  return { sim, peak, trace };
}
const sine = (hz: number, v = 1) => (t: number) => v * Math.sin(2 * Math.PI * hz * t);
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

test("each module's board does what its panel says", () => {
  // Q Saw: a volt an octave from its exponential converter (RT1 trimmed), 133 Hz at 0 V.
  const hz = [-1, 0, 1, 2].map((v) => run("vco", {}, () => [v, 0], 0.01).sim.read().hz);
  expect(hz.map((f) => Math.round(f * 10) / 10)).toEqual([66.7, 133.3, 266.5, 532.8]);
  // Q Filter with Freq in the middle, about 1 kHz: low-pass keeps 100 Hz and loses 4 kHz, high-pass the other way round.
  const low = run("vcf", { freq: 0.5, res: 0.3 }, (t) => [sine(100)(t), 0]).peak, high = run("vcf", { freq: 0.5, res: 0.3 }, (t) => [sine(4000)(t), 0]).peak;
  expect(low[0]).toBeGreaterThan(0.9); expect(high[0]).toBeLessThan(0.1);
  expect(high[2]).toBeGreaterThan(0.9); expect(low[2]).toBeLessThan(0.05);
  // A volt more CV doubles its cutoff.
  const f0 = run("vcf", { cv: 1 }, () => [0, 0], 0.01).sim.read().hz, f1 = run("vcf", { cv: 1 }, () => [0, 1], 0.01).sim.read().hz;
  expect(f1 / f0).toBeCloseTo(2, 1);
  // Q Level: shut at 0 V of CV, unity at 5 V (Level at 0).
  expect(run("vca", { level: 0, cv: 1 }, (t) => [sine(440, 5)(t), 0]).peak[0]).toBeLessThan(0.001);
  expect(run("vca", { level: 0, cv: 1 }, (t) => [sine(440, 5)(t), 5]).peak[0]).toBeCloseTo(5, 0);
  // Q Swell: up to about 9.8 V while the gate is held, back down after it to rest within a tenth of a volt of 0 V, so a
  // VCA it drives shuts between notes.
  const swell = run("env", { attack: 0, release: 0 }, (t) => [t < 0.1 ? 5 : 0], 0.4).trace[0];
  expect(Math.max(...swell)).toBeGreaterThan(9.5);
  expect(swell[swell.length - 1]).toBeLessThan(0.1);
  expect(swell[swell.length - 1]).toBeGreaterThanOrEqual(0);
  // Q Bus: its board's own gains, a channel at full level straight to Main at unity, nothing on a send that's down.
  const bus = makeSim("mix", 48000, { "level-1": 1, main: 1, "a-1": 0, "b-1": 1 });
  if (!(bus instanceof Linear)) throw new Error("Q Bus mixes with its board's gains");
  expect(bus.gain("in-1", "main")).toBeCloseTo(1, 2);
  expect(bus.gain("in-1", "send-a")).toBeCloseTo(0, 3);
  expect(bus.gain("in-1", "send-b")).toBeCloseTo(1, 2);
  expect(bus.gain("ret-a", "main")).toBeGreaterThan(0.2);
  // Q Steps with a cable in Clock In: a step on each rise of a 5 V clock, its own 555 let go and the gate following
  // the clock; a clock under Q1's threshold (about 1.3 V) moves nothing.
  const steps = (volts: number) => {
    const seq = makeSim("seq", 48000), x = new Float64Array(1), y = new Float64Array(2);
    seq.plugged?.([true]);
    let gate = 0;
    for (let i = 0; i < 48000; i++) { x[0] = (i * 4) % 48000 < 24000 ? volts : 0; seq.step(x, y); gate = Math.max(gate, y[0]); }
    return { ...seq.read(), gate };
  };
  expect(steps(5)).toMatchObject({ step: 5, hz: 0, gate: 5 });
  expect(steps(1)).toMatchObject({ step: 1 });
});

const cable = (a: string, ja: string, b: string, jb: string) => ({ from: [a, ja] as [string, string], to: [b, jb] as [string, string] });
const VOICE: WallSpec = {
  modules: ["seq", "vco", "vcf", "vca", "env", "mix", "out"].map((k): WallSpec["modules"][number] => ({ id: k, kind: k, knobs: k === "mix" ? { "a-1": 0.9 } : {} })),
  cables: [
    cable("seq", "cv", "vco", "voct"), cable("vco", "saw", "vcf", "in"), cable("vcf", "lp", "vca", "in"),
    cable("seq", "gate", "env", "gate"), cable("env", "out", "vca", "cv"), cable("vca", "out", "mix", "in-1"), cable("mix", "main", "out", "in-l"),
  ],
  returns: [],
};

test("a patched voice plays the sequencer's notes, and a send through a spring comes back on its return", () => {
  // It plays: Q Out is fed both sides (In R takes In L), and the VCO sits at the step's volts, 133 Hz up an octave a volt.
  const { left, right, wall } = renderWall(VOICE, 1.5);
  expect(rms(left)).toBeGreaterThan(0.01);
  expect(right).toEqual(left);
  const now = wall.state(), seq = now.find((m) => m.id === "seq"), vco = now.find((m) => m.id === "vco");
  expect(vco?.read.hz).toBeCloseTo(133.3 * 2 ** (seq?.read.cv ?? NaN), 0);
  // Send A (channel 1's A knob is up) through the room's spring, as Q Amp's rig runs it, back into Return A.
  const spring = {
    amp: "lead", pedal: null, drive: 0, swaps: {}, board: [], mic: DEFAULT_ROOM.mic, bypass: false, oversample: 2, direct: true,
    knobs: { gain: 0, bass: 5, mid: 5, treble: 5, master: 0, noise: 0, rate: 5, depth: 0 }, loop: [{ kind: "spring", dwell: 6, mix: 10 }],
  } satisfies AmpSettings;
  const wet = renderWall({ ...VOICE, returns: [{ mixer: "mix", aux: "a", settings: spring }] }, 1.5).left;
  expect(rms(wet.map((v, i) => v - left[i]))).toBeGreaterThan(rms(left) * 0.05);
});

test("Q Hiss hisses, and samples its own noise on each clock", () => {
  // Its noise a few volts rms, and with only a clock in, a new level of that noise on each rise, held between.
  const hiss = makeSim("noise", 48000), hx = new Float64Array(2), hy = new Float64Array(2), held = new Set<number>();
  hiss.plugged?.([false, true]);
  let sq = 0;
  for (let i = 0; i < 48000; i++) { hx[1] = (i * 4) % 48000 < 24000 ? 10 : 0; hiss.step(hx, hy); sq += hy[0] ** 2; held.add(hy[1]); }
  expect(Math.sqrt(sq / 48000)).toBeGreaterThan(0.5);
  expect(Math.sqrt(sq / 48000)).toBeLessThan(5);
  // Four clocks, each tracking for about a fifth of a millisecond (ten samples), then holding.
  expect(held.size).toBeGreaterThan(4);
  expect(held.size).toBeLessThan(80);
});
