// Measures the transistor ladder low-pass (US 3,475,623) before it is built as a sound wall module (#5748), and what
// would make it fit the page's audio thread:
//   1. The first voice of WALL.md as it is, and Q Filter alone on the voice's own saw.
//   2. A ladder of ten transistors in the circuit solver in Q Filter's place: a drive pair on a tail current, four
//      common-base pairs stacked on it with a capacitor across each stage, the top capacitor read out.
//   3. The same ladder as its stage equations, every number from the same parts (the tail current, C, VT, the
//      dividers and the output gain), as the wall already plays its switching modules: how far it lands from the
//      solved ladder, and what it costs.
//   bun apps/fm-daw/bench/ladder.ts
import { Circuit, type Part } from "@rustybuns/gear/circuit";
import { makeSim } from "../src/wall/sims.ts";
import { renderWall, type WallSpec } from "../src/wall/wall.ts";

const RATE = 48000, SECONDS = 3, N = RATE * SECONDS;
const VT = (1.380649e-23 * 299.15) / 1.602176634e-19;
const cable = (a: string, ja: string, b: string, jb: string) => ({ from: [a, ja] as [string, string], to: [b, jb] as [string, string] });
const VOICE: WallSpec = {
  modules: ["seq", "vco", "vcf", "vca", "env", "mix", "out"].map((k): WallSpec["modules"][number] => ({ id: k, kind: k, knobs: k === "mix" ? { "a-1": 0.9 } : {} })),
  cables: [
    cable("seq", "cv", "vco", "voct"), cable("vco", "saw", "vcf", "in"), cable("vcf", "lp", "vca", "in"),
    cable("seq", "gate", "env", "gate"), cable("env", "out", "vca", "cv"), cable("vca", "out", "mix", "in-1"), cable("mix", "main", "out", "in-l"),
  ],
  returns: [],
};

const time = (f: () => void) => { const t = performance.now(); f(); return performance.now() - t; };
const us = (ms: number) => (ms * 1000) / N;
const realTime = (usPerSample: number) => 1e6 / RATE / usPerSample;

// The whole voice, warmed up once.
renderWall(VOICE, 0.5);
const voice = us(time(() => renderWall(VOICE, SECONDS)));

// Q Filter's input in the voice: Q Saw stepping through three octaves.
const saw = new Float64Array(N);
{
  const vco = makeSim("vco", RATE), x = new Float64Array(vco.ins.length), y = new Float64Array(vco.outs.length);
  for (let i = 0; i < N; i++) { x[0] = ((i / 12000) | 0) % 3; vco.step(x, y); saw[i] = y[0]; }
}
const vcf = (() => {
  const f = makeSim("vcf", RATE), x = new Float64Array(f.ins.length), y = new Float64Array(f.outs.length);
  for (let i = 0; i < RATE / 2; i++) { x[0] = saw[i]; f.step(x, y); }
  return { us: us(time(() => { for (let i = 0; i < N; i++) { x[0] = saw[i]; f.step(x, y); } })), hz: f.read().hz };
})();

/** The ladder's parts: the input and feedback dividers, the capacitor, the output gain (the difference amplifier's). */
const P = { rin: 22e3, rg: 220, rfb: 2.2e3, rres: 100e3, farads: 33e-9, ri: 10e3, rf: 470e3 };
const gainOut = P.rf / P.ri, kin = P.rg / (P.rin + P.rg), kfb = (res: number) => P.rg / (P.rfb + P.rres * (1 - res) + P.rg);

/**
 * The ladder as a netlist: Q1/Q2 the drive pair on a tail current (what an exponential converter would set), four
 * common-base pairs stacked on it with a capacitor across each stage's emitters, their bases on a bias string from
 * +12 V, the top pair's collectors on +12 V. Two followers and a difference amplifier read the top capacitor; Res
 * (`res`, 0 to 1) feeds the output back into Q2's base through 2.2k and the pot into 220R.
 */
function ladder(res: number): Part[] {
  const p: Part[] = [
    { kind: "V", a: "V12", b: "gnd", volts: 12 }, { kind: "V", a: "VN12", b: "gnd", volts: -12 },
    { kind: "R", a: "IN", b: "INB", ohms: P.rin }, { kind: "R", a: "INB", b: "gnd", ohms: P.rg },
    { kind: "R", a: "OUT", b: "FBB", ohms: P.rfb + P.rres * (1 - res) }, { kind: "R", a: "FBB", b: "gnd", ohms: P.rg },
    { kind: "BJT", c: "L1", b: "INB", e: "TAIL" }, { kind: "BJT", c: "R1", b: "FBB", e: "TAIL" },
    { kind: "I", a: "TAIL", b: "VN12", amps: 0 },
    { kind: "R", a: "V12", b: "B4", ohms: 6.8e3 }, { kind: "R", a: "B4", b: "B3", ohms: 1e3 }, { kind: "R", a: "B3", b: "B2", ohms: 1e3 },
    { kind: "R", a: "B2", b: "B1", ohms: 1e3 }, { kind: "R", a: "B1", b: "gnd", ohms: 1.5e3 },
  ];
  for (let s = 1; s <= 4; s++) {
    p.push({ kind: "C", a: `B${s}`, b: "gnd", farads: 10e-6 }, { kind: "C", a: `L${s}`, b: `R${s}`, farads: P.farads });
    const up = s === 4 ? ["V12", "V12"] : [`L${s + 1}`, `R${s + 1}`];
    p.push({ kind: "BJT", c: up[0], b: `B${s}`, e: `L${s}` }, { kind: "BJT", c: up[1], b: `B${s}`, e: `R${s}` });
  }
  p.push(
    { kind: "Opamp", plus: "L4", minus: "BL", out: "BL", rail: 0 }, { kind: "Opamp", plus: "R4", minus: "BR", out: "BR", rail: 0 },
    { kind: "R", a: "BL", b: "DM", ohms: P.ri }, { kind: "R", a: "DM", b: "OUT", ohms: P.rf },
    { kind: "R", a: "BR", b: "DP", ohms: P.ri }, { kind: "R", a: "DP", b: "gnd", ohms: P.rf },
    { kind: "Opamp", plus: "DP", minus: "DM", out: "OUT", rail: 0 },
  );
  return p;
}

function solved(amps: number, res: number, input: Float64Array) {
  const c = new Circuit({ parts: ladder(res), input: "IN", output: "OUT" }, RATE);
  c.push(c.sourceInto("VN12"), amps);
  c.settle(0);
  const rest = c.volts("OUT"), out = new Float64Array(N);
  for (let i = 0; i < RATE / 2; i++) c.step(input[i]);
  const before = c.iterations, misses = c.misses;
  const ms = time(() => { for (let i = 0; i < N; i++) out[i] = c.step(input[i]) - rest; });
  return { us: us(ms), newton: (c.iterations - before) / N, misses: c.misses - misses, out };
}

/**
 * The ladder's stage equations from the same parts. Each stage's capacitor voltage u_k moves with the difference of
 * its pair's current and the pair's below: C du_k/dt = (I/2)(tanh(u_{k-1}/2VT) − tanh(u_k/2VT)), the drive pair's
 * u_0 = −(Q1's base − Q2's base); the out is the difference amplifier's gain across the top capacitor. Four steps a
 * sample (explicit), so the top of the cutoff's range stays stable.
 */
function stages(amps: number, res: number, input: Float64Array) {
  const u = new Float64Array(5), out = new Float64Array(N), over = 4, h = 1 / (RATE * over), g = (amps / (2 * P.farads)) * h, k = kfb(res);
  let y = 0;
  const run = (from: number, to: number, keep: boolean) => {
    for (let i = from; i < to; i++) {
      const vin = input[i] * kin;
      for (let o = 0; o < over; o++) {
        u[0] = -(vin - k * y);
        let below = Math.tanh(u[0] / (2 * VT));
        for (let s = 1; s <= 4; s++) { const t = Math.tanh(u[s] / (2 * VT)); u[s] += g * (below - t); below = t; }
        y = -gainOut * u[4];
      }
      if (keep) out[i] = y;
    }
  };
  run(0, RATE / 2, false);
  y = 0; u.fill(0);
  const ms = time(() => run(0, N, true));
  return { us: us(ms), out };
}

/** How far `b` lands from `a`: the rms of the difference over the rms of `a`. */
const apart = (a: Float64Array, b: Float64Array) => {
  let d = 0, s = 0;
  for (let i = RATE / 10; i < N; i++) { d += (a[i] - b[i]) ** 2; s += a[i] ** 2; }
  return Math.sqrt(d / s);
};
const rms = (a: Float64Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

console.log(`first voice (7 modules): ${voice.toFixed(2)} µs a sample, ${realTime(voice).toFixed(1)}x real time`);
console.log(`Q Filter alone: ${vcf.us.toFixed(2)} µs a sample (cutoff ${Math.round(vcf.hz)} Hz)`);
for (const [amps, res] of [[30e-6, 0], [100e-6, 0.5], [400e-6, 0.9]]) {
  const hz = amps / (8 * Math.PI * P.farads * VT), s = solved(amps, res, saw), m = stages(amps, res, saw);
  const withSolved = voice - vcf.us + s.us, withStages = voice - vcf.us + m.us;
  console.log(`\nladder, tail ${amps * 1e6} µA (cutoff ${Math.round(hz)} Hz), Res ${res}, out ${rms(s.out).toFixed(2)} V rms:`);
  console.log(`  solved: ${s.us.toFixed(2)} µs a sample (${(s.us / vcf.us).toFixed(1)}x Q Filter), ${s.newton.toFixed(2)} Newton steps, ${s.misses} misses; voice ${withSolved.toFixed(2)} µs, ${realTime(withSolved).toFixed(1)}x real time`);
  console.log(`  stages: ${m.us.toFixed(2)} µs a sample, ${(apart(s.out, m.out) * 100).toFixed(1)}% from the solved ladder; voice ${withStages.toFixed(2)} µs, ${realTime(withStages).toFixed(1)}x real time`);
}
