// The amps and pedals by name, and their knobs. Each amp is a list of 12AX7
// stages, the pots between them, a tone stack and a power stage; `buildRig`
// turns an amp, an optional pedal and the knobs into a rig. Names are ours and
// describe the circuit, never a product.
import { fuzz, hardClip, overdrive, toneStack, triodeStage, type StageSpec, type ToneSpec } from "./circuits.ts";
import type { RigSpec } from "./rig.ts";

/** The amp's front panel, every knob 0 to 10. Noise is how much the first tube's resistors hiss (see `noiseScale`). */
export interface Knobs { gain: number; bass: number; mid: number; treble: number; master: number; noise: number }

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
  /** How many power tubes to draw. */
  powerTubes: number;
  knobs: Knobs;
}

export const AMPS: AmpDef[] = [
  {
    id: "brit", name: "Q Brit 3", blurb: "Three tubes, the middle one biased cold, tone stack last. Crunch to lead.",
    stages: [{ rk: 2.7e3, ck: 0.68e-6 }, { rk: 10e3, ck: 0, cc: 22e-9 }, { rk: 820, ck: 0.68e-6, cc: 22e-9 }],
    pots: [1, null, 0.8], tone: {}, power: 1.5, powerTubes: 2,
    knobs: { gain: 7, bass: 5, mid: 7, treble: 6, master: 5, noise: 3 },
  },
  {
    id: "lead", name: "Q Lead 50", blurb: "Four tubes, small coupling caps for tight lows, two cold clippers. Saturated high gain.",
    stages: [{ rk: 1.5e3, ck: 0.47e-6, cc: 10e-9 }, { rk: 39e3, ck: 0, cc: 4.7e-9 }, { rk: 10e3, ck: 0, cc: 22e-9 }, { rk: 1.5e3, ck: 0.47e-6, cc: 22e-9 }],
    pots: [1, null, 0.9, 0.6], tone: { slope: 47e3, cTreble: 250e-12 }, power: 2, powerTubes: 4,
    knobs: { gain: 7, bass: 4, mid: 5, treble: 7, master: 5, noise: 3 },
  },
  {
    id: "triple", name: "Q Triple", blurb: "Fat bypass caps early, a scooped tone stack. Big, loose, modern.",
    stages: [{ rk: 1.8e3, ck: 22e-6 }, { rk: 1.8e3, ck: 1e-6, cc: 22e-9 }, { rk: 15e3, ck: 0, cc: 10e-9 }, { rk: 1.5e3, ck: 0.68e-6, cc: 22e-9 }],
    pots: [1, null, 0.9, 0.6], tone: { cTreble: 500e-12, cBass: 100e-9, cMid: 47e-9 }, power: 2.5, powerTubes: 4,
    knobs: { gain: 7, bass: 7, mid: 2, treble: 7, master: 5, noise: 1 },
  },
];

export interface PedalDef { id: string; name: string; blurb: string; net: (drive: number) => RigSpec["links"][number]["net"] }

export const PEDALS: PedalDef[] = [
  { id: "drive", name: "Q Drive", blurb: "Diodes in the op-amp's feedback: rounded clipping and a mid push. In front of an amp at low Drive, it tightens the lows.", net: (d) => overdrive(d / 10) },
  { id: "fuzz", name: "Q Fuzz", blurb: "×2000 into soft diodes, then hard ones. Its input resistor hisses, and the hiss gets clipped with the notes.", net: (d) => fuzz(d / 10) },
  { id: "dist", name: "Q Dist", blurb: "Op-amp gain into two diodes to ground: flat-topped, buzzy distortion.", net: (d) => hardClip(10e3 + (d / 10) * 190e3) },
];

/** The Gain knob's pot: log taper, never quite off, all the way open at 10. */
export const gainPot = (gain: number) => 0.02 + 0.98 * (gain / 10) ** 2;

/**
 * The Noise knob as a multiple of a perfect resistor's thermal noise: 0 is silent,
 * then 1× at 1 up to 1000× (+60 dB, a worn carbon resistor and then some) at 10.
 */
export const noiseScale = (k: number) => (k <= 0 ? 0 : 10 ** ((k - 1) / 3));

/** A pedal (or none) into an amp, with these knobs. */
export function buildRig(amp: AmpDef, knobs: Knobs, pedal?: { def: PedalDef; drive: number }): RigSpec {
  const links: RigSpec["links"] = [];
  if (pedal) links.push({ net: pedal.def.net(pedal.drive) });
  amp.stages.forEach((s, i) => links.push({ net: triodeStage({ ...s, noisy: i === 0 }), gain: amp.pots[i] ?? gainPot(knobs.gain) }));
  links.push({ net: toneStack({ ...amp.tone, bass: knobs.bass, mid: knobs.mid, treble: knobs.treble }) });
  return { inputVolts: 0.5, links, power: amp.power * (0.25 + 0.15 * knobs.master), cab: true, noise: noiseScale(knobs.noise) };
}

const amp = (id: string) => {
  const a = AMPS.find((x) => x.id === id);
  if (!a) throw new Error(`no amp ${id}`);
  return a;
};
const pedalRig = (net: RigSpec["links"][number]["net"]): RigSpec => ({ inputVolts: 0.5, links: [{ net }], power: 0, cab: false });

/** Every amp at its own knob settings, and the two pedals alone into a clean desk. */
export const RIGS = {
  "hard-clip": pedalRig(hardClip()),
  overdrive: pedalRig(overdrive(0.6)),
  brit: buildRig(amp("brit"), amp("brit").knobs),
  lead: buildRig(amp("lead"), amp("lead").knobs),
  triple: buildRig(amp("triple"), amp("triple").knobs),
} satisfies Record<string, RigSpec>;
