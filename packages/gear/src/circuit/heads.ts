// Q Amp's tube amp heads, one kit for Qollab Studio and Sound Guy Simulator: each head's 12AX7 stages, the pots
// between them, its tone stack, power stage and supply, and its knobs as they come. `headRig` turns a head and its
// knobs into a rig. Qollab Studio builds each stage from its tscircuit board (apps/fm-daw/circuits, the schematic
// the player sees) and passes those builders in; anywhere else (Sound Guy Simulator's show) gets `triodeNet` and
// `toneNet`, the same boards written as parts. Names are ours and describe the circuit, never a product.
import { DEFAULT_MIC, type Mic } from "./cab.ts";
import type { Netlist } from "./mna.ts";
import type { Link, RigSpec } from "./rig.ts";

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

/** The passive bass/mid/treble network most guitar amps share. Knobs 0 to 10. */
export interface ToneSpec { bass: number; mid: number; treble: number; slope?: number; cTreble?: number; cBass?: number; cMid?: number }

/**
 * The amp's front panel, every knob 0 to 10. Noise is how much the first tube's resistors hiss (see `noiseScale`).
 * Rate and Depth are the bias tremolo's, only on a head that has one (`Head.trem`).
 */
export interface HeadKnobs { gain: number; bass: number; mid: number; treble: number; master: number; noise: number; rate: number; depth: number }

export interface Head {
  id: string;
  name: string;
  blurb: string;
  stages: StageSpec[];
  /** The pot ahead of each stage, 0 to 1; `null` is the Gain knob. */
  pots: (number | null)[];
  tone: Omit<ToneSpec, "bass" | "mid" | "treble">;
  /** Power-stage drive at Master 5. */
  power: number;
  /** Output tubes, in push-pull pairs (and drawn on the page). */
  powerTubes: number;
  /** The supply's resistance, ohms: how much it sags when you dig in. */
  sag: number;
  /** An LFO on the power tubes' bias (power.ts), with Rate and Depth knobs. */
  trem?: boolean;
  knobs: HeadKnobs;
}

export const HEADS: Head[] = [
  {
    id: "brit", name: "Q Brit 3", blurb: "Three tubes, the middle one biased cold, tone stack last. Crunch to lead.",
    stages: [{ rk: 2.7e3, ck: 0.68e-6 }, { rk: 10e3, ck: 0, cc: 22e-9 }, { rk: 820, ck: 0.68e-6, cc: 22e-9 }],
    pots: [1, null, 0.8], tone: {}, power: 1.5, powerTubes: 2, sag: 250,
    knobs: { gain: 7, bass: 5, mid: 7, treble: 6, master: 5, noise: 3, rate: 5, depth: 0 },
  },
  {
    id: "lead", name: "Q Lead 50", blurb: "Four tubes, small coupling caps for tight lows, two cold clippers. Saturated high gain.",
    stages: [{ rk: 1.5e3, ck: 0.47e-6, cc: 10e-9 }, { rk: 39e3, ck: 0, cc: 4.7e-9 }, { rk: 10e3, ck: 0, cc: 22e-9 }, { rk: 1.5e3, ck: 0.47e-6, cc: 22e-9 }],
    pots: [1, null, 0.9, 0.6], tone: { slope: 47e3, cTreble: 250e-12 }, power: 2, powerTubes: 4, sag: 90,
    knobs: { gain: 7, bass: 4, mid: 5, treble: 7, master: 5, noise: 3, rate: 5, depth: 0 },
  },
  {
    id: "triple", name: "Q Triple", blurb: "Fat bypass caps early, a scooped tone stack. Big, loose, modern.",
    stages: [{ rk: 1.8e3, ck: 22e-6 }, { rk: 1.8e3, ck: 1e-6, cc: 22e-9 }, { rk: 15e3, ck: 0, cc: 10e-9 }, { rk: 1.5e3, ck: 0.68e-6, cc: 22e-9 }],
    pots: [1, null, 0.9, 0.6], tone: { cTreble: 500e-12, cBass: 100e-9, cMid: 47e-9 }, power: 2.5, powerTubes: 4, sag: 60,
    knobs: { gain: 7, bass: 7, mid: 2, treble: 7, master: 5, noise: 1, rate: 5, depth: 0 },
  },
  {
    id: "clean", name: "Q Clean T", blurb: "Two tubes, big bypass caps, a tube rectifier, and an LFO on the output tubes' bias: the whole amp throbs, and dug in, the dips clip less than the peaks.",
    stages: [{ rk: 1.5e3, ck: 22e-6 }, { rk: 1.5e3, ck: 0, cc: 22e-9 }],
    pots: [null, 0.5], tone: { cTreble: 250e-12 }, power: 1.2, powerTubes: 2, sag: 250, trem: true,
    knobs: { gain: 4, bass: 5, mid: 4, treble: 6, master: 5, noise: 2, rate: 5, depth: 6 },
  },
];

/** A head by id. */
export function head(id: string): Head {
  const h = HEADS.find((x) => x.id === id);
  if (!h) throw new Error(`no head ${id}: ${HEADS.map((x) => x.id).join(", ")}`);
  return h;
}

/** The Gain knob's pot: log taper, never quite off, all the way open at 10. */
export const gainPot = (gain: number) => 0.02 + 0.98 * (gain / 10) ** 2;

/**
 * The Noise knob as a multiple of a perfect resistor's thermal noise: 0 is silent,
 * then 1× at 1 up to 1000× (+60 dB, a worn carbon resistor and then some) at 10.
 */
export const noiseScale = (k: number) => (k <= 0 ? 0 : 10 ** ((k - 1) / 3));

/** The Rate knob in Hz: a slow 1.5 Hz sway at 0 up to a 9.5 Hz flutter at 10. */
export const tremHz = (rate: number) => 1.5 + 0.8 * rate;
/** The bias tremolo for these knobs, or none on a head without one. */
export const tremOf = (h: Head, knobs: HeadKnobs) => (h.trem ? { hz: tremHz(knobs.rate), depth: knobs.depth / 10 } : undefined);

/** One 12AX7 stage as parts: the triode board (apps/fm-daw/circuits/triode.tsx) with this stage's values. */
export function triodeNet(s: StageSpec): Netlist {
  return {
    input: "in",
    output: "plate",
    parts: [
      { kind: "C", a: "in", b: "g0", farads: s.cc ?? 22e-9 },
      { kind: "R", a: "g0", b: "gnd", ohms: 1e6 },
      { kind: "R", a: "g0", b: "grid", ohms: 68e3, ...(s.noisy ? { noisy: true } : {}) },
      { kind: "Triode", p: "plate", g: "grid", k: "cath" },
      { kind: "R", a: "cath", b: "gnd", ohms: s.rk },
      ...(s.ck > 0 ? [{ kind: "C" as const, a: "cath", b: "gnd", farads: s.ck }] : []),
      { kind: "R", a: "bplus", b: "plate", ohms: s.rp ?? 100e3, ...(s.noisy ? { noisy: true } : {}) },
      { kind: "V", a: "bplus", b: "gnd", volts: s.bplus ?? 300 },
    ],
  };
}

/** The tone stack as parts: the tone board (apps/fm-daw/circuits/tone.tsx) at these knobs, bass and mid log taper. */
export function toneNet(t: ToneSpec): Netlist {
  const pot = (k: number) => Math.min(Math.max(k / 10, 0.001), 0.999);
  const tr = pot(t.treble), bass = pot(t.bass) ** 2, mid = pot(t.mid) ** 2;
  return {
    input: "in",
    output: "out",
    parts: [
      { kind: "C", a: "in", b: "t", farads: t.cTreble ?? 470e-12 },
      { kind: "R", a: "t", b: "out", ohms: (1 - tr) * 220e3 },
      { kind: "R", a: "out", b: "low", ohms: tr * 220e3 },
      { kind: "R", a: "in", b: "slope", ohms: t.slope ?? 33e3 },
      { kind: "C", a: "slope", b: "low", farads: t.cBass ?? 22e-9 },
      { kind: "C", a: "slope", b: "mid", farads: t.cMid ?? 22e-9 },
      { kind: "R", a: "low", b: "mid", ohms: bass * 1e6 },
      { kind: "R", a: "mid", b: "gnd", ohms: mid * 25e3 },
      { kind: "R", a: "out", b: "gnd", ohms: 1e6 },
    ],
  };
}

export interface HeadRigOptions {
  /** How a stage and the tone stack become netlists: Qollab Studio passes its boards' readers. */
  stage?: (s: StageSpec) => Netlist;
  tone?: (t: ToneSpec) => Netlist;
  /** What goes ahead of the head (a pedal). */
  pre?: Link[];
  /** The mic on the cab, and the ohms on the speaker jack (0 for nothing plugged in). */
  mic?: Mic;
  load?: number;
}

/** A head at these knobs, as a rig: its stages with their pots, the tone stack, the power stage and the cab. */
export function headRig(h: Head, knobs: HeadKnobs, { stage = triodeNet, tone = toneNet, pre = [], mic = DEFAULT_MIC, load = 8 }: HeadRigOptions = {}): RigSpec {
  const links: Link[] = [...pre];
  h.stages.forEach((s, i) => links.push({ net: stage({ ...s, noisy: i === 0 }), gain: h.pots[i] ?? gainPot(knobs.gain) }));
  links.push({ net: tone({ ...h.tone, bass: knobs.bass, mid: knobs.mid, treble: knobs.treble }) });
  return {
    inputVolts: 0.5, links, power: h.power * (0.25 + 0.15 * knobs.master), noise: noiseScale(knobs.noise),
    output: { pairs: h.powerTubes / 2, sag: h.sag, load, trem: tremOf(h, knobs) }, cab: mic,
  };
}
