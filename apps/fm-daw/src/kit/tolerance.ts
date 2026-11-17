// How far a pedal you build may sound from the sim: the board's netlist played many times, each time with every part
// off its printed value by as much as a shop's part may be (5% resistors, 10% capacitors, 20% pots, diodes from one
// bag spread over a factor of two in leakage). Each build gives a small-signal frequency response and an output
// level at playing level; the band is the lowest and highest of them at each frequency. No DOM: the build sheet
// (sheet.ts) draws the band, and hands in a `pause` so a long run doesn't hold up the page.
import { Circuit, type Netlist, type Part } from "@rustybuns/gear/circuit";
import { mulberry32 } from "@rustybuns/util";

/** How far each kind of part may be off its printed value, as a fraction either way. */
export const TOLERANCE = { resistor: 0.05, capacitor: 0.1, pot: 0.2, diode: 2 } as const;

/** The frequencies the band is drawn at, Hz: two to an octave from 40 Hz to 10 kHz. */
export const BAND_HZ = Array.from({ length: 17 }, (_, i) => Math.round(40 * 2 ** (i / 2)));

const SR = 48000;
/** A small signal: well under where the diodes start to bend it, even at ×2000. */
const SMALL = 1e-4;
/** Playing level: a guitar's 0.2 V at 220 Hz, as `test/circuit.test.ts` plays the boards. */
const PLAY = { volts: 0.2, hz: 220 };

const DIODE = { is: 2.52e-9, n: 1.752 }; // the solver's own default, when a part doesn't say

/** `net` as one build: every resistor, capacitor, pot and diode drawn once from its tolerance by `rand` (0 to 1). */
export function build(net: Netlist, rand: () => number): Netlist {
  const off = (tol: number) => 1 + tol * (2 * rand() - 1);
  const parts = net.parts.map((p): Part => {
    if (p.kind === "R") return { ...p, noisy: false, ohms: p.ohms * off(TOLERANCE.resistor) };
    if (p.kind === "C") return { ...p, farads: p.farads * off(TOLERANCE.capacitor) };
    if (p.kind === "Pot") return { ...p, ohms: p.ohms * off(TOLERANCE.pot) };
    if (p.kind === "D") return { ...p, is: (p.is ?? DIODE.is) * TOLERANCE.diode ** (2 * rand() - 1), n: (p.n ?? DIODE.n) * off(0.03) };
    return p;
  });
  return { ...net, parts };
}

/** The sim itself, with no part off (its hiss off too, so it measures the same each time). */
const quiet = (net: Netlist): Netlist => ({ ...net, parts: net.parts.map((p) => (p.kind === "R" && p.noisy ? { ...p, noisy: false } : p)) });

/** A sine's amplitude at the output, read over whole cycles once the circuit has settled into it (a lock-in, so DC and hum don't count). */
function amplitude(net: Netlist, hz: number, volts: number): number {
  const c = new Circuit(net, SR), rest = c.settle(0);
  const per = SR / hz, skip = Math.ceil(SR * 0.05 + 2 * per), cycles = Math.max(4, Math.ceil(hz * 0.04));
  const n = Math.round(cycles * per), w = (2 * Math.PI * hz) / SR;
  let re = 0, im = 0;
  for (let i = 0; i < skip + n; i++) {
    const o = c.step(volts * Math.sin(w * i)) - rest;
    if (i >= skip) { re += o * Math.cos(w * i); im += o * Math.sin(w * i); }
  }
  return (2 / n) * Math.hypot(re, im);
}

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));

/** One build measured: its gain in dB at each of `BAND_HZ` (small signal), and its output level at playing level. */
export function measure(net: Netlist): { gain: number[]; level: number } {
  return { gain: BAND_HZ.map((hz) => db(amplitude(net, hz, SMALL) / SMALL)), level: db(amplitude(net, PLAY.hz, PLAY.volts)) };
}

/** The sim's response and how far the builds went from it, in dB: `lo` and `hi` per frequency, and the level's spread. */
export interface Band {
  hz: number[];
  sim: number[];
  lo: number[];
  hi: number[];
  /** The output level at playing level: the sim's in dB re 1 V, and the builds' lowest and highest against it. */
  level: { sim: number; lo: number; hi: number };
  runs: number;
}

/**
 * The tolerance band of `net` over `runs` builds, seeded so the same pedal shows the same band. `pause` is awaited
 * between builds (the page yields to the browser there); `onRun(i)` says how far it has got.
 */
export async function toleranceBand(net: Netlist, o: { runs?: number; seed?: number; pause?: () => Promise<void>; onRun?: (done: number, of: number) => void } = {}): Promise<Band> {
  const runs = o.runs ?? 24, rand = mulberry32(o.seed ?? 4939);
  const sim = measure(quiet(net));
  const lo = [...sim.gain], hi = [...sim.gain];
  let levelLo = 0, levelHi = 0;
  for (let r = 0; r < runs; r++) {
    await o.pause?.();
    const m = measure(build(net, rand));
    m.gain.forEach((g, i) => { lo[i] = Math.min(lo[i], g); hi[i] = Math.max(hi[i], g); });
    levelLo = Math.min(levelLo, m.level - sim.level); levelHi = Math.max(levelHi, m.level - sim.level);
    o.onRun?.(r + 1, runs);
  }
  return { hz: BAND_HZ, sim: sim.gain, lo, hi, level: { sim: sim.level, lo: levelLo, hi: levelHi }, runs };
}

/** The widest a build went from the sim at any frequency, dB either way. */
export const widest = (b: Band): number => Math.max(...b.sim.map((s, i) => Math.max(s - b.lo[i], b.hi[i] - s)));

/** The band in a sentence: how far a build may be from the sim, in the response and in level. */
export function bandText(b: Band): string {
  const f = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;
  return `Over ${b.runs} builds with ${TOLERANCE.resistor * 100}% resistors, ${TOLERANCE.capacitor * 100}% capacitors, ${TOLERANCE.pot * 100}% pots and diodes from one bag: `
    + `the tone stays within ${widest(b).toFixed(1)} dB of the sim, and the output level within ${f(b.level.lo)} to ${f(b.level.hi)} dB.`;
}
