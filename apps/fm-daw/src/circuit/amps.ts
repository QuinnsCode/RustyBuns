// The amps and pedals by name, and their knobs. The amps are Q Amp's heads, kept in `@rustybuns/gear/circuit`
// (heads.ts) so Sound Guy Simulator plays the same ones; here each stage is built from its tscircuit board.
// `buildRig` turns an amp, an optional pedal, the knobs, the mic on the cab and what is on the speaker jack into a
// rig. Names are ours and describe the circuit, never a product.
import { fuzz, hardClip, overdrive, toneStack, triodeStage, type BoardId, type Swaps } from "./circuits.ts";
import { envelopeWah, germaniumFuzz, octaveUp, opticalComp, opticalTremolo, phaser, vibe, wah } from "./effects.ts";
import { DEFAULT_MIC, HEADS, headRig, type Blend, type Head, type HeadKnobs, type Link, type Mic, type Mod, type Netlist, type RigSpec } from "@rustybuns/gear/circuit";
import type { BoardPedal, BoardStep } from "../amp/messages.ts";

export { gainPot, noiseScale, tremHz, tremOf } from "@rustybuns/gear/circuit";
/** The amp's front panel (gear's `HeadKnobs`). */
export type Knobs = HeadKnobs;
/** One of Q Amp's heads (gear's `Head`). */
export type AmpDef = Head;
export const AMPS: AmpDef[] = HEADS;

/**
 * A pedal: its circuit at its one knob (0 to 10) with the player's part swaps, what the knob is called (Drive if not
 * said), what moves its `VarR`s, and its board (`circuits/<board>.tsx`), if it has one: a pedal dropped on the bench doesn't.
 */
export interface PedalDef { id: string; name: string; blurb: string; knob?: string; board?: BoardId; net: (k: number, swaps?: Swaps) => Netlist; mods?: (k: number) => Mod[] }

export const PEDALS: PedalDef[] = [
  { id: "drive", name: "Q Drive", blurb: "Diodes in the op-amp's feedback: rounded clipping and a mid push. In front of an amp at low Drive, it tightens the lows.", board: "drive", net: (d, s) => overdrive(d / 10, s) },
  { id: "fuzz", name: "Q Fuzz", blurb: "×2000 into soft diodes, then hard ones. Its input resistor hisses, and the hiss gets clipped with the notes.", board: "fuzz", net: (d, s) => fuzz(d / 10, s) },
  { id: "dist", name: "Q Dist", blurb: "Op-amp gain into two diodes to ground: flat-topped, buzzy distortion.", board: "dist", net: (d, s) => hardClip(10e3 + (d / 10) * 190e3, s) },
  {
    id: "phase", name: "Q Phase", knob: "Rate", blurb: "Four all-pass stages, JFETs as their resistors, one LFO on the gates, some fed back: two notches sweeping.",
    board: "phase", net: (_, s) => phaser(s), mods: (k) => [{ ctl: "gate", hz: 0.05 + (k / 10) ** 2 * 6 }],
  },
  {
    id: "vibe", name: "Q Vibe", knob: "Speed", blurb: "Four phase stages, four LDRs, one lamp. The lamp heats faster than it cools, so the throb leans.",
    board: "vibe", net: (_, s) => vibe(s), mods: (k) => [{ ctl: "lamp", hz: 0.5 + (k / 10) * 9, pow: 2, lag: [[0.02, 0.07], [0.004, 0.05]] }],
  },
  {
    id: "trem", name: "Q Trem", knob: "Rate", blurb: "An LED blinking on an LDR that shunts the signal to ground. The LDR recovers slowly, so each dip has a soft back.",
    board: "trem", net: (_, s) => opticalTremolo(s), mods: (k) => [{ ctl: "led", hz: 1 + (k / 10) * 11, lag: [[0.002, 0.02]] }],
  },
  { id: "wah", name: "Q Wah", knob: "Treadle", blurb: "An inductor and capacitor ringing; the treadle pot sets a Miller capacitor's size. Heel ~550 Hz, toe ~1.8 kHz. An expression pedal (MIDI CC 11) rocks it.", board: "wah", net: (k, s) => wah(k / 10, s) },
  {
    id: "autowah", name: "Q Envelope", knob: "Sens", blurb: "The same wah, its treadle pushed by how hard you play: a quick attack, then it falls back to the heel.",
    board: "autowah", net: (_, s) => envelopeWah(s), mods: (k) => [{ ctl: "foot", sens: 0.5 + (k / 10) ** 2 * 10, lag: [[0.005, 0.15]] }],
  },
  {
    id: "comp", name: "Q Squeeze", knob: "Sustain", blurb: "Optical compressor: the output lights an LED that darkens an LDR ahead of the gain. The LDR's slow recovery is the smooth release.",
    board: "comp", net: (k, s) => opticalComp(k / 10, s), mods: () => [{ ctl: "led", sens: 0.4, lag: [[0.01, 0.6]] }],
  },
  { id: "octave", name: "Q Octave", knob: "Fuzz", blurb: "A fuzz, then two diodes keeping the higher of it and its mirror: the wave folds, the pitch doubles.", board: "octave", net: (k, s) => octaveUp(k / 10, s) },
  {
    id: "germ", name: "Q Germ", knob: "Warm", blurb: "Two germanium transistors. They leak more as the room warms, and the bias moves: cold is spitty, 25 °C at 4, hot is mush.",
    board: "germ", net: (k, s) => germaniumFuzz(5 + k * 5, s),
  },
];

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
    else if (def) links.push({ net: def.net(p.drive, p.swaps), mods: def.mods?.(p.drive) });
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
  const pre = pedal ? [{ net: pedal.def.net(pedal.drive, pedal.swaps), mods: pedal.def.mods?.(pedal.drive) }] : [];
  return headRig(amp, knobs, { stage: triodeStage, tone: toneStack, pre, mic: room.mic, load: room.load });
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
  clean: buildRig(amp("clean"), amp("clean").knobs),
} satisfies Record<string, RigSpec>;
