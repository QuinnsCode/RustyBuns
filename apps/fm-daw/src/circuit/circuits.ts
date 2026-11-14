// Pedals and tube-amp pieces as netlists, from textbook topologies. Values are
// starting points to tune by ear, not copies of any one product.
// Pedals run on a split supply (op-amp rails ±4 V around ground) instead of a
// 9 V battery and a 4.5 V bias divider: the same circuit, minus the bias parts.
import type { Netlist, Part } from "./mna.ts";

const R = (a: string, b: string, ohms: number, noisy = false): Part => ({ kind: "R", a, b, ohms, noisy });
const C = (a: string, b: string, farads: number): Part => ({ kind: "C", a, b, farads });
const D = (a: string, k: string): Part => ({ kind: "D", a, k });

/**
 * Hard-clip distortion: an op-amp gain stage (up to ×101 above ~34 Hz), then
 * two silicon diodes to ground that flatten the tops, then a one-pole tone.
 * `circuits/hard-clip.tsx` draws the same board in tscircuit.
 */
export function hardClip(gain = 100_000): Netlist {
  return {
    input: "IN", output: "OUT",
    parts: [
      C("IN", "inp", 100e-9), R("inp", "gnd", 1e6),
      { kind: "Opamp", plus: "inp", minus: "inn", out: "opout" },
      R("opout", "inn", gain), R("inn", "fb", 1e3), C("fb", "gnd", 4.7e-6),
      R("opout", "clip", 1e3), D("clip", "gnd"), D("gnd", "clip"),
      R("clip", "OUT", 10e3), C("OUT", "gnd", 10e-9),
    ],
  };
}

/**
 * Mid-hump overdrive: the diodes sit in the op-amp's feedback, so they round
 * the wave off instead of cutting it, and the 4.7k/47nF leg only gives gain
 * above ~720 Hz, so the lows stay clean and the mids push. `drive` 0 to 1.
 */
export function overdrive(drive = 0.5): Netlist {
  return {
    input: "IN", output: "OUT",
    parts: [
      C("IN", "inp", 1e-6), R("inp", "gnd", 510e3),
      { kind: "Opamp", plus: "inp", minus: "inn", out: "opout" },
      R("inn", "leg", 4.7e3), C("leg", "gnd", 47e-9),
      R("opout", "inn", 51e3 + drive * 500e3), C("opout", "inn", 51e-12), D("opout", "inn"), D("inn", "opout"),
      R("opout", "OUT", 1e3), C("OUT", "gnd", 220e-9),
    ],
  };
}

/**
 * Fuzz: an op-amp at up to ×2000, its feedback diodes rounding the wave off,
 * then two diodes to ground squaring what's left. Its 1M input resistor hisses,
 * and that hiss gets the same ×2000 and the same clipping as the guitar: the
 * fizz around the notes and the wash when you stop. `drive` 0 to 1.
 */
export function fuzz(drive = 0.7): Netlist {
  return {
    input: "IN", output: "OUT",
    parts: [
      C("IN", "inp", 100e-9), R("inp", "gnd", 1e6, true),
      { kind: "Opamp", plus: "inp", minus: "inn", out: "opout" },
      R("inn", "leg", 1e3), C("leg", "gnd", 10e-6),
      R("opout", "inn", 20e3 + drive ** 2 * 2e6), C("opout", "inn", 22e-12), D("opout", "inn"), D("inn", "opout"),
      R("opout", "clip", 2.2e3), D("clip", "gnd"), D("gnd", "clip"),
      R("clip", "OUT", 4.7e3), C("OUT", "gnd", 15e-9),
    ],
  };
}

/** One 12AX7 gain stage: coupling cap and grid leak, grid stopper, plate load, cathode resistor (and bypass cap). */
export interface StageSpec {
  /** Cathode resistor: bigger is colder, cleaner and more asymmetric when it clips. */
  rk: number;
  /** Cathode bypass cap (0 for none): more gain above 1/(2π·rk·ck). Small values keep the lows tight. */
  ck: number;
  /** Coupling cap into the grid: smaller cuts more lows before this stage. */
  cc?: number;
  rp?: number;
  bplus?: number;
  /** Its grid stopper and plate load hiss (the first stage: everything after amplifies it). */
  noisy?: boolean;
}

export function triodeStage(s: StageSpec): Netlist {
  const parts: Part[] = [
    C("IN", "a", s.cc ?? 22e-9), R("a", "gnd", 1e6), R("a", "g", 68e3, s.noisy),
    { kind: "Triode", p: "OUT", g: "g", k: "k" },
    R("k", "gnd", s.rk),
    { kind: "V", a: "bplus", b: "gnd", volts: s.bplus ?? 300 }, R("bplus", "OUT", s.rp ?? 100e3, s.noisy),
  ];
  if (s.ck > 0) parts.push(C("k", "gnd", s.ck));
  return { input: "IN", output: "OUT", parts };
}

/** The passive bass/mid/treble network most guitar amps share. Knobs 0 to 10. */
export interface ToneSpec { bass: number; mid: number; treble: number; slope?: number; cTreble?: number; cBass?: number; cMid?: number }

export function toneStack(t: ToneSpec): Netlist {
  const pot = (k: number) => Math.min(Math.max(k / 10, 0.001), 0.999);
  const tr = pot(t.treble), bass = pot(t.bass) ** 2, mid = pot(t.mid) ** 2; // bass and mid are log-taper pots
  const TREBLE = 220e3, BASS = 1e6, MID = 25e3;
  return {
    input: "IN", output: "OUT",
    parts: [
      C("IN", "top", t.cTreble ?? 470e-12), R("top", "OUT", (1 - tr) * TREBLE), R("OUT", "low", tr * TREBLE),
      R("IN", "x", t.slope ?? 33e3), C("x", "low", t.cBass ?? 22e-9), C("x", "mid", t.cMid ?? 22e-9),
      R("low", "mid", bass * BASS), R("mid", "gnd", mid * MID),
      R("OUT", "gnd", 1e6), // the next stage's grid leak
    ],
  };
}
