// The amps and pedals by name, and their knobs. Each amp is a list of 12AX7
// stages, the pots between them, a tone stack, a push-pull power stage and its
// supply; `buildRig` turns an amp, an optional pedal, the knobs, the mic on the cab
// and what is on the speaker jack into a rig. Names are ours and
// describe the circuit, never a product.
import { fuzz, hardClip, overdrive, toneStack, triodeStage, type BoardId, type StageSpec, type Swaps, type ToneSpec } from "./circuits.ts";
import { germaniumFuzz, octaveUp, opticalComp, opticalTremolo, phaser, vibe, wah } from "./effects.ts";
import { DEFAULT_MIC, type Blend, type Link, type Mic, type Mod, type Netlist, type RigSpec } from "@rustybuns/gear/circuit";
import type { BoardPedal, BoardStep } from "../amp/messages.ts";

/**
 * The amp's front panel, every knob 0 to 10. Noise is how much the first tube's resistors hiss (see `noiseScale`).
 * Rate and Depth are the bias tremolo's, only on an amp that has one (`AmpDef.trem`).
 */
export interface Knobs { gain: number; bass: number; mid: number; treble: number; master: number; noise: number; rate: number; depth: number }

export interface AmpDef {
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
  knobs: Knobs;
}

export const AMPS: AmpDef[] = [
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

/**
 * A pedal: its circuit at its one knob (0 to 10) with the player's part swaps, what the knob is called (Drive if not
 * said), what moves its `VarR`s, and its board (`circuits/<board>.tsx`), if it has one: a pedal dropped on the bench,
 * and the effects in effects.ts, don't.
 */
export interface PedalDef { id: string; name: string; blurb: string; knob?: string; board?: BoardId; net: (k: number, swaps?: Swaps) => Netlist; mods?: (k: number) => Mod[] }

export const PEDALS: PedalDef[] = [
  { id: "drive", name: "Q Drive", blurb: "Diodes in the op-amp's feedback: rounded clipping and a mid push. In front of an amp at low Drive, it tightens the lows.", board: "drive", net: (d, s) => overdrive(d / 10, s) },
  { id: "fuzz", name: "Q Fuzz", blurb: "×2000 into soft diodes, then hard ones. Its input resistor hisses, and the hiss gets clipped with the notes.", board: "fuzz", net: (d, s) => fuzz(d / 10, s) },
  { id: "dist", name: "Q Dist", blurb: "Op-amp gain into two diodes to ground: flat-topped, buzzy distortion.", board: "dist", net: (d, s) => hardClip(10e3 + (d / 10) * 190e3, s) },
  {
    id: "phase", name: "Q Phase", knob: "Rate", blurb: "Four all-pass stages, JFETs as their resistors, one LFO on the gates, some fed back: two notches sweeping.",
    net: () => phaser(0.45), mods: (k) => [{ ctl: "gate", hz: 0.05 + (k / 10) ** 2 * 6 }],
  },
  {
    id: "vibe", name: "Q Vibe", knob: "Speed", blurb: "Four phase stages, four LDRs, one lamp. The lamp heats faster than it cools, so the throb leans.",
    net: vibe, mods: (k) => [{ ctl: "lamp", hz: 0.5 + (k / 10) * 9, pow: 2, lag: [[0.02, 0.07], [0.004, 0.05]] }],
  },
  {
    id: "trem", name: "Q Trem", knob: "Rate", blurb: "An LED blinking on an LDR that shunts the signal to ground. The LDR recovers slowly, so each dip has a soft back.",
    net: opticalTremolo, mods: (k) => [{ ctl: "led", hz: 1 + (k / 10) * 11, lag: [[0.002, 0.02]] }],
  },
  { id: "wah", name: "Q Wah", knob: "Treadle", blurb: "An inductor and capacitor ringing; the treadle pot sets a Miller capacitor's size. Heel ~550 Hz, toe ~1.8 kHz. An expression pedal (MIDI CC 11) rocks it.", net: (k) => wah(k / 10) },
  {
    id: "autowah", name: "Q Envelope", knob: "Sens", blurb: "The same wah, its treadle pushed by how hard you play: a quick attack, then it falls back to the heel.",
    net: () => wah("foot"), mods: (k) => [{ ctl: "foot", sens: 0.5 + (k / 10) ** 2 * 10, lag: [[0.005, 0.15]] }],
  },
  {
    id: "comp", name: "Q Squeeze", knob: "Sustain", blurb: "Optical compressor: the output lights an LED that darkens an LDR ahead of the gain. The LDR's slow recovery is the smooth release.",
    net: (k) => opticalComp(k / 10), mods: () => [{ ctl: "led", sens: 0.4, lag: [[0.01, 0.6]] }],
  },
  { id: "octave", name: "Q Octave", knob: "Fuzz", blurb: "A fuzz, then two diodes keeping the higher of it and its mirror: the wave folds, the pitch doubles.", net: (k) => octaveUp(k / 10) },
  {
    id: "germ", name: "Q Germ", knob: "Warm", blurb: "Two germanium transistors. They leak more as the room warms, and the bias moves: cold is spitty, 25 °C at 4, hot is mush.",
    net: (k) => germaniumFuzz(5 + k * 5),
  },
];

/** The Gain knob's pot: log taper, never quite off, all the way open at 10. */
export const gainPot = (gain: number) => 0.02 + 0.98 * (gain / 10) ** 2;

/**
 * The Noise knob as a multiple of a perfect resistor's thermal noise: 0 is silent,
 * then 1× at 1 up to 1000× (+60 dB, a worn carbon resistor and then some) at 10.
 */
export const noiseScale = (k: number) => (k <= 0 ? 0 : 10 ** ((k - 1) / 3));

/** The Rate knob in Hz: a slow 1.5 Hz sway at 0 up to a 9.5 Hz flutter at 10. */
export const tremHz = (rate: number) => 1.5 + 0.8 * rate;
/** The bias tremolo for these knobs, or none on an amp without one. */
export const tremOf = (amp: AmpDef, knobs: Knobs) => (amp.trem ? { hz: tremHz(knobs.rate), depth: knobs.depth / 10 } : undefined);

/** The cab and the jack: where the mic sits, and the ohms on the speaker jack (0 for nothing plugged in). */
export interface Room { mic: Mic; load: number }
export const DEFAULT_ROOM: Room = { mic: DEFAULT_MIC, load: 8 };

/**
 * A board's pedals as rig links, in order, with a `Blend` for each split: what goes ahead of the amp's links.
 * An unknown pedal is left out; a split with no pedal on either side is no split.
 */
export function boardLinks(board: readonly BoardStep[]): { links: Link[]; blends: Blend[] } {
  const links: Link[] = [], blends: Blend[] = [];
  const one = (p: BoardPedal): number => {
    const def = PEDALS.find((d) => d.id === p.pedal);
    if (p.pedal === "bench" && p.bench) links.push({ net: p.bench });
    else if (def) links.push({ net: def.net(p.drive), mods: def.mods?.(p.drive) });
    else return 0;
    return 1;
  };
  for (const st of board) {
    if (!("split" in st)) { one(st); continue; }
    const at = links.length, lanes = st.split.map((side) => side.reduce((n, p) => n + one(p), 0));
    if (links.length > at) blends.push({ at, lanes, mix: st.mix });
  }
  return { links, blends };
}

/** A pedal (or none, and with the player's part swaps) into an amp, with these knobs, into a cab. */
export function buildRig(amp: AmpDef, knobs: Knobs, pedal?: { def: PedalDef; drive: number; swaps?: Swaps }, room: Room = DEFAULT_ROOM): RigSpec {
  const links: RigSpec["links"] = [];
  if (pedal) links.push({ net: pedal.def.net(pedal.drive, pedal.swaps), mods: pedal.def.mods?.(pedal.drive) });
  amp.stages.forEach((s, i) => links.push({ net: triodeStage({ ...s, noisy: i === 0 }), gain: amp.pots[i] ?? gainPot(knobs.gain) }));
  links.push({ net: toneStack({ ...amp.tone, bass: knobs.bass, mid: knobs.mid, treble: knobs.treble }) });
  return {
    inputVolts: 0.5, links, power: amp.power * (0.25 + 0.15 * knobs.master), noise: noiseScale(knobs.noise),
    output: { pairs: amp.powerTubes / 2, sag: amp.sag, load: room.load, trem: tremOf(amp, knobs) }, cab: room.mic,
  };
}

/** A pedal (or nothing) straight into a desk: no amp, no power stage, no cab. The loop's machines go after it. */
export function deskRig(pedal?: { def: PedalDef; drive: number; swaps?: Swaps }): RigSpec {
  return { inputVolts: 0.5, links: pedal ? [{ net: pedal.def.net(pedal.drive, pedal.swaps), mods: pedal.def.mods?.(pedal.drive) }] : [], power: 0, cab: null };
}

const amp = (id: string) => {
  const a = AMPS.find((x) => x.id === id);
  if (!a) throw new Error(`no amp ${id}`);
  return a;
};
const pedalRig = (net: Netlist): RigSpec => ({ inputVolts: 0.5, links: [{ net }], power: 0, cab: null });

/** Every amp at its own knob settings, and the two pedals alone into a clean desk. */
export const RIGS = {
  "hard-clip": pedalRig(hardClip()),
  overdrive: pedalRig(overdrive(0.6)),
  brit: buildRig(amp("brit"), amp("brit").knobs),
  lead: buildRig(amp("lead"), amp("lead").knobs),
  triple: buildRig(amp("triple"), amp("triple").knobs),
} satisfies Record<string, RigSpec>;
