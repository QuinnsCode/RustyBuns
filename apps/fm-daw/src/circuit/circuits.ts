// Pedals and tube-amp pieces as netlists, from textbook topologies. Values are
// starting points to tune by ear, not copies of any one product.
// Pedals run on a split supply (op-amp rails ±4 V around ground) instead of a
// 9 V battery and a 4.5 V bias divider: the same circuit, minus the bias parts.
import type { Netlist, Part } from "./mna.ts";

const R = (a: string, b: string, ohms: number, noisy = false): Part => ({ kind: "R", a, b, ohms, noisy });
const C = (a: string, b: string, farads: number): Part => ({ kind: "C", a, b, farads });
const D = (a: string, k: string): Part => ({ kind: "D", a, k });
const L = (a: string, b: string, henries: number): Part => ({ kind: "L", a, b, henries });

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

// Circuit effects (ANALOG.md section 3). Op-amps that never clip (`rail: 0`) cost
// no Newton; the parts that move are `VarR`s, and a rig `Mod` moves them.
const lin = (plus: string, minus: string, out: string): Part => ({ kind: "Opamp", plus, minus, out, rail: 0 });
const varR = (a: string, b: string, ctl: string, hi: number, lo: number): Part => ({ kind: "VarR", a, b, ctl, hi, lo });

/**
 * One all-pass stage: flat in level, its phase turning through 180° around 1/(2πRC),
 * where R is whatever sits on the + input (a JFET's channel, an LDR).
 */
function allPass(from: string, to: string, i: number, cap: number, r: Part): Part[] {
  return [R(from, `apn${i}`, 10e3), R(to, `apn${i}`, 10e3), lin(`app${i}`, `apn${i}`, to), r, C(`app${i}`, "gnd", cap)];
}

/** The input summed (inverted) with `regen` of the last stage, then the stages, then dry and wet mixed: where they cancel are the notches. */
function phaseShifter(caps: number[], r: (from: string, i: number) => Part, regen: number, mix = 1): Netlist {
  const parts: Part[] = [R("IN", "sn", 10e3), R("s0", "sn", 10e3), lin("gnd", "sn", "s0")];
  let at = "s0";
  caps.forEach((cap, i) => { const to = `ap${i + 1}`; parts.push(...allPass(at, to, i, cap, r(at, i))); at = to; });
  if (regen > 0) parts.push(R(at, "sn", 10e3 / regen));
  parts.push(R("s0", "mn", 10e3), R(at, "mn", 10e3 / mix), R("OUT", "mn", 10e3), lin("gnd", "mn", "OUT"));
  return { input: "IN", output: "OUT", parts };
}

/**
 * Phaser: four all-pass stages whose resistors are JFET channels, all on one gate
 * voltage (control "gate", an LFO). Mixed with the dry signal, two notches sweep;
 * `regen` 0 to 0.7 feeds the last stage back in and sharpens them.
 */
export function phaser(regen = 0.4): Netlist {
  return phaseShifter([47e-9, 47e-9, 47e-9, 47e-9], (from, i) => varR(from, `app${i}`, "gate", 40e3, 2.5e3), regen);
}

/**
 * Vibe: four phase-shift stages, each a different capacitor, their LDRs all under
 * one lamp (control "lamp"). The lamp heats faster than it cools, so the sweep
 * lingers at the dark end: the lopsided throb, set by the `Mod`'s lags.
 */
export function vibe(): Netlist {
  return phaseShifter([15e-9, 220e-9, 470e-9, 4.7e-9], (from, i) => varR(from, `app${i}`, "lamp", 250e3, 4e3), 0);
}

/** Optical tremolo: a series resistor and an LDR to ground (control "led"), buffered. The LDR's slow recovery softens each dip's back edge. */
export function opticalTremolo(): Netlist {
  return { input: "IN", output: "OUT", parts: [R("IN", "a", 4.7e3), varR("a", "gnd", "led", 1e6, 600), lin("a", "OUT", "OUT")] };
}

/**
 * Wah: a 0.5 H inductor and a small capacitor ring at a peak; a second capacitor
 * hangs off an inverting stage whose gain is the treadle pot, so it looks
 * (1 + gain) times bigger (Miller) and pulls the peak down: heel ~450 Hz, toe ~2 kHz.
 * `treadle` 0 (heel) to 1 (toe), or a `VarR` on control "foot" for an auto-wah.
 */
export function wah(treadle: number | "foot" = 0.5): Netlist {
  const pot: Part = treadle === "foot" ? varR("inv", "mn", "foot", 220e3, 100) : R("inv", "mn", 100 + (1 - treadle) ** 2 * 220e3);
  return {
    input: "IN", output: "OUT",
    parts: [
      R("IN", "T", 15e3), L("T", "lr", 0.5), R("lr", "gnd", 60), C("T", "gnd", 4.7e-9), R("T", "gnd", 68e3),
      lin("T", "b", "b"), R("b", "mn", 10e3), pot, lin("gnd", "mn", "inv"), C("inv", "T", 10e-9),
      R("b", "fn", 10e3), R("OUT", "fn", 22e3), lin("gnd", "fn", "OUT"),
    ],
  };
}

/**
 * Optical compressor: a series resistor and an LDR to ground ahead of an op-amp
 * gain stage; the stage's output lights the LED (control "led", an envelope
 * `Mod`) that darkens the LDR. Feedback: the louder it gets, the more it is
 * turned down, and the LDR's slow recovery is the smooth release. `sustain` 0 to 1 is the stage's gain.
 */
export function opticalComp(sustain = 0.5): Netlist {
  return {
    input: "IN", output: "OUT",
    parts: [
      C("IN", "i", 1e-6), R("i", "a", 10e3), varR("a", "gnd", "led", 2e6, 300),
      { kind: "Opamp", plus: "a", minus: "fb", out: "OUT" }, R("OUT", "fb", 10e3 + sustain ** 2 * 300e3), R("fb", "g", 4.7e3), C("g", "gnd", 4.7e-6),
    ],
  };
}

/**
 * Octave up: a diode-clipped op-amp fuzz, an inverter beside it, and two diodes
 * keeping whichever is higher. Folding the negative half up doubles the pitch;
 * the fuzz first squares the wave so the fold is clean. `fuzz` 0 to 1.
 */
export function octaveUp(fuzz = 0.6): Netlist {
  return {
    input: "IN", output: "OUT",
    parts: [
      C("IN", "inp", 100e-9), R("inp", "gnd", 1e6),
      { kind: "Opamp", plus: "inp", minus: "inn", out: "f" },
      R("inn", "leg", 1e3), C("leg", "gnd", 4.7e-6), R("f", "inn", 10e3 + fuzz ** 2 * 200e3), D("f", "inn"), D("inn", "f"),
      R("f", "nn", 10e3), R("nf", "nn", 10e3), lin("gnd", "nn", "nf"),
      D("f", "r"), D("nf", "r"), R("r", "gnd", 10e3),
      C("r", "OUT", 1e-6), R("OUT", "gnd", 100e3),
    ],
  };
}

/**
 * Two-transistor germanium fuzz: PNP on a negative supply, the second stage's
 * emitter feeding the first one's base for bias. Germanium leaks, and the leak
 * doubles every 10 °C: `celsius` moves the bias, and with it the fuzz from
 * gated and spitty (cold) to smooth and then mushy (hot).
 */
export function germaniumFuzz(celsius = 25): Netlist {
  const ge = { pnp: true, is: 2e-6, bf: 90, br: 4, celsius } as const;
  return {
    input: "IN", output: "OUT",
    parts: [
      { kind: "V", a: "gnd", b: "vm", volts: 9 },
      C("IN", "b1", 2.2e-6),
      { kind: "Q", c: "c1", b: "b1", e: "gnd", ...ge }, R("c1", "vm", 33e3),
      { kind: "Q", c: "c2", b: "c1", e: "e2", ...ge }, R("c2", "x", 470), R("x", "vm", 8.2e3),
      R("e2", "b1", 100e3), R("e2", "gnd", 1e3), C("e2", "gnd", 20e-6),
      C("c2", "o", 10e-9), R("o", "OUT", 47e3), R("OUT", "gnd", 4.7e3), // the volume pot, a tenth up
    ],
  };
}
