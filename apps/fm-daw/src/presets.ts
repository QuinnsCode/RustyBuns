// The default kit and a demo groove. Every sound is the same 4-op FM voice;
// drums lean on the pitch envelope and noise, synths on the algorithm.
import { NPARAMS, OPS, P, clampParam } from "./engine/params.ts";
import type { Note, Project, TrackDoc } from "./project.ts";

export type OpSpec = [ratio: number, level: number, attack: number, decay: number, sustain: number, release: number];
export interface PatchSpec {
  ops: Partial<Record<0 | 1 | 2 | 3, OpSpec>>;
  algo?: number; fb?: number;
  pitch?: [amount: number, decay: number];
  noise?: [level: number, decay: number, tone: number];
  gain?: number; pan?: number; vel?: number;
  /** How much goes to Space, the shared reverb and delay. */
  send?: number;
  /** How much harder hits brighten the note (see P.VEL_TONE). */
  velTone?: number;
  /** The analog voice instead of FM: op 1's envelope and level shape the amp. */
  analog?: {
    detune?: number; sub?: number; cutoff?: number; res?: number;
    fenv?: [amount: number, attack: number, decay: number];
    lfo?: [rate: number, toCutoff: number, toPitch: number];
    glide?: number; drive?: number;
    /** 0 SVF, 1 ladder, 2 vowel, 3 diode ladder (see P.FILTER). */
    filter?: number;
    /** 0 saws to 1 pulses, and the LFO's depth on pulse width. */
    wave?: number; pwm?: number;
    /** LFO shape (0 sine, 1 tri, 2 saw down, 3 square), tempo sync (LFO_DIVS index, 0 free), restart on each note. */
    lfoShape?: number; sync?: number; retrig?: boolean;
  };
  /** Supersaw mix (0 keeps two saws) and wavefolder, both analog only. */
  supersaw?: number;
  fold?: number;
  /** Chorus mode: 0 off, 1, 2, 3 both; 4 flanger, 5 phaser. */
  chorus?: number;
  /** FM too: the LFO (rate, sync, shape) on modulation depth, for growls. */
  lfo?: { rate?: number; depth?: number; shape?: number; sync?: number; retrig?: boolean };
}

const OFF: OpSpec = [1, 0, 0.001, 0.3, 0, 0.1];

export function patch(s: PatchSpec): number[] {
  const p = new Array<number>(NPARAMS).fill(0);
  for (let op = 0; op < OPS; op++) {
    const o = s.ops[op as 0] ?? OFF;
    for (let f = 0; f < 6; f++) p[op * 6 + f] = o[f];
  }
  p[P.ALGO] = s.algo ?? 0;
  p[P.FEEDBACK] = s.fb ?? 0;
  p[P.PITCH_AMT] = s.pitch?.[0] ?? 0;
  p[P.PITCH_DECAY] = s.pitch?.[1] ?? 0.05;
  p[P.NOISE] = s.noise?.[0] ?? 0;
  p[P.NOISE_DECAY] = s.noise?.[1] ?? 0.05;
  p[P.NOISE_TONE] = s.noise?.[2] ?? 0.5;
  p[P.GAIN] = s.gain ?? 0.7;
  p[P.PAN] = s.pan ?? 0;
  p[P.VEL] = s.vel ?? 0.6;
  p[P.SEND] = s.send ?? 0.3;
  p[P.VEL_TONE] = s.velTone ?? 0;
  const a = s.analog;
  p[P.MODE] = a ? 1 : 0;
  p[P.DETUNE] = a?.detune ?? 0.3;
  p[P.SUB] = a?.sub ?? 0.5;
  p[P.CUTOFF] = a?.cutoff ?? 0.7;
  p[P.RES] = a?.res ?? 0.2;
  p[P.FENV_AMT] = a?.fenv?.[0] ?? 0.3;
  p[P.FENV_ATTACK] = a?.fenv?.[1] ?? 0.002;
  p[P.FENV_DECAY] = a?.fenv?.[2] ?? 0.4;
  p[P.LFO_RATE] = a?.lfo?.[0] ?? 0.2;
  p[P.LFO_CUT] = a?.lfo?.[1] ?? 0;
  p[P.LFO_PITCH] = a?.lfo?.[2] ?? 0;
  p[P.GLIDE] = a?.glide ?? 0;
  p[P.DRIVE] = a?.drive ?? 0;
  p[P.FILTER] = a?.filter ?? 0;
  p[P.WAVE] = a?.wave ?? 0;
  p[P.PWM] = a?.pwm ?? 0;
  p[P.LFO_SHAPE] = a?.lfoShape ?? 0;
  p[P.LFO_SYNC] = a?.sync ?? 0;
  p[P.LFO_RETRIG] = a?.retrig ? 1 : 0;
  p[P.CHORUS] = s.chorus ?? 0;
  p[P.SUPER] = a ? s.supersaw ?? 0 : 0;
  p[P.FOLD] = a ? s.fold ?? 0 : 0;
  if (s.lfo && !a) {
    p[P.LFO_RATE] = s.lfo.rate ?? 1; p[P.LFO_CUT] = s.lfo.depth ?? 0; p[P.LFO_SHAPE] = s.lfo.shape ?? 0;
    p[P.LFO_SYNC] = s.lfo.sync ?? 0; p[P.LFO_RETRIG] = s.lfo.retrig ? 1 : 0;
  }
  return p.map((v, i) => clampParam(i, v));
}

export const KIT: { name: string; kind: "drum" | "synth"; root: number; params: number[] }[] = [
  { name: "Kick", kind: "drum", root: 33, params: patch({
    ops: { 0: [1, 1, 0.0005, 0.5, 0, 0.08], 1: [1, 0.22, 0.0005, 0.04, 0, 0.03] },
    pitch: [30, 0.07], noise: [0.08, 0.008, 1], gain: 0.95, vel: 0.4, send: 0 }) },
  { name: "Snare", kind: "drum", root: 50, params: patch({
    ops: { 0: [1, 0.7, 0.0005, 0.16, 0, 0.06], 1: [1.6, 0.35, 0.0005, 0.08, 0, 0.05] },
    pitch: [10, 0.03], noise: [0.75, 0.2, 0.75], gain: 0.7 }) },
  { name: "Hat", kind: "drum", root: 76, params: patch({
    ops: { 0: [1, 0.5, 0.0005, 0.05, 0, 0.04], 1: [1.41, 0.9, 0.0005, 0.06, 0, 0.04],
           2: [2.73, 0.8, 0.0005, 0.06, 0, 0.04], 3: [3.91, 0.7, 0.0005, 0.06, 0, 0.04] },
    fb: 0.6, noise: [0.55, 0.045, 1], gain: 0.4, pan: 0.25, vel: 0.8 }) },
  { name: "Clap", kind: "drum", root: 60, params: patch({
    ops: { 0: [1, 0.08, 0.0005, 0.05, 0, 0.05] },
    noise: [1, 0.14, 0.55], gain: 0.55, pan: -0.15 }) },
  { name: "Tom", kind: "drum", root: 45, params: patch({
    ops: { 0: [1, 1, 0.0005, 0.35, 0, 0.1], 1: [1.5, 0.12, 0.0005, 0.05, 0, 0.05] },
    pitch: [12, 0.09], gain: 0.7, pan: -0.3 }) },
  { name: "Bass", kind: "synth", root: 36, params: patch({
    ops: { 0: [1, 1, 0.002, 0.4, 0.55, 0.08], 1: [1, 0.45, 0.002, 0.25, 0.15, 0.08], 2: [2, 0.12, 0.002, 0.1, 0, 0.05] },
    gain: 0.6, vel: 0.5, send: 0 }) },
  { name: "Keys", kind: "synth", root: 60, params: patch({
    ops: { 0: [1, 1, 0.002, 1.4, 0.25, 0.35], 1: [1, 0.3, 0.002, 1.0, 0.1, 0.3],
           2: [1, 0.55, 0.002, 1.1, 0.2, 0.35], 3: [14, 0.12, 0.001, 0.12, 0, 0.1] },
    algo: 1, gain: 0.45, pan: 0.2, vel: 0.7 }) },
  { name: "Pad", kind: "synth", root: 60, params: patch({
    ops: { 0: [1, 0.8, 0.5, 1.5, 0.8, 1.2], 1: [2, 0.18, 0.6, 2, 0.6, 1.2],
           2: [1.004, 0.7, 0.5, 1.5, 0.8, 1.2], 3: [3, 0.12, 0.8, 2, 0.5, 1.2] },
    algo: 1, fb: 0.15, gain: 0.3, pan: -0.2, vel: 0.3 }) },
  // four more synths, quiet until a song or you give them notes
  { name: "Lead", kind: "synth", root: 72, params: patch({
    ops: { 0: [1, 1, 0.01, 0.8, 0.7, 0.25], 1: [1, 0.35, 0.01, 0.4, 0.3, 0.2] }, gain: 0.4 }) },
  { name: "Strings", kind: "synth", root: 60, params: patch({
    ops: { 0: [1, 0.8, 0.25, 2, 0.8, 0.8] },
    analog: { detune: 0.25, sub: 0, cutoff: 0.6, res: 0.2, fenv: [0.1, 0.3, 1], lfo: [5, 0, 0.3] }, gain: 0.35, send: 0.6 }) },
  { name: "Analog bass", kind: "synth", root: 36, params: patch({
    ops: { 0: [1, 1, 0.003, 0.6, 0.6, 0.1] },
    analog: { detune: 0.3, sub: 0.5, cutoff: 0.35, res: 0.35, fenv: [0.4, 0.002, 0.3], drive: 0.3 }, gain: 0.45, send: 0 }) },
  { name: "Bells", kind: "synth", root: 72, params: patch({
    ops: { 0: [1, 1, 0.001, 2.5, 0, 1.5], 1: [3.5, 0.3, 0.001, 1.5, 0, 1] }, gain: 0.3, send: 0.7 }) },
];

const step = (i: number, m: number, v = 0.85, l = 0.25): Note => ({ s: i * 0.25, l, m, v });

export function demoProject(): Project {
  const bars = 2, steps = bars * 16;
  const notes: Note[][] = KIT.map(() => []);
  for (let i = 0; i < steps; i += 4) notes[0].push(step(i, 33, 0.95));
  notes[1].push(step(4, 50), step(12, 50), step(20, 50), step(28, 50), step(31, 50, 0.45));
  for (let i = 0; i < steps; i += 2) notes[2].push(step(i, 76, i % 4 === 2 ? 0.9 : 0.5));
  notes[3].push(step(12, 60, 0.7), step(28, 60, 0.7));
  notes[4].push(step(27, 45, 0.7), step(29, 41, 0.75));
  const bass: [number, number][] = [[0, 45], [3, 45], [6, 48], [8, 45], [11, 52], [14, 50],
    [16, 41], [19, 41], [22, 45], [24, 41], [27, 48], [30, 47]];
  for (const [i, m] of bass) notes[5].push(step(i, m, 0.8, 0.2));
  for (const m of [57, 60, 64, 67]) notes[6].push({ s: 0, l: 1.5, m, v: 0.6 }, { s: 2.5, l: 1, m, v: 0.45 });
  for (const m of [53, 57, 60, 64]) notes[6].push({ s: 4, l: 1.5, m, v: 0.6 }, { s: 6.5, l: 1, m, v: 0.45 });
  notes[7].push({ s: 0, l: 3.75, m: 45, v: 0.7 }, { s: 0, l: 3.75, m: 52, v: 0.7 },
    { s: 4, l: 3.75, m: 41, v: 0.7 }, { s: 4, l: 3.75, m: 48, v: 0.7 });
  const tracks: TrackDoc[] = KIT.map((k, i) => ({
    ...k, params: k.params.slice(), notes: notes[i].sort((a, b) => a.s - b.s || a.m - b.m), mute: false, solo: false,
  }));
  return { v: 1, bpm: 118, swing: 0.12, space: 0.15, squash: 0, bars, tracks };
}

/** Random but tame: levels and feedback capped, envelopes short-ish, gain kept. */
export function randomPatch(kind: "drum" | "synth", keep: number[], rnd: () => number = Math.random): number[] {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  if (keep[P.MODE] >= 0.5) {
    // analog stays analog: a tame cutoff, resonance and drive, slow LFOs
    return patch({
      ops: { 0: [1, 0.8 + rnd() * 0.2, kind === "drum" ? 0.0005 : 0.002 + rnd() * 0.2, 0.1 + rnd() * 1.5, kind === "drum" ? 0 : rnd() * 0.9, 0.05 + rnd() * 0.6] },
      analog: {
        detune: rnd() * 0.6, sub: rnd() * 0.7, cutoff: 0.25 + rnd() * 0.5, res: rnd() * 0.6,
        fenv: [rnd() * 0.8 - 0.2, 0.001 + rnd() * rnd() * 0.5, 0.05 + rnd() * 1.5],
        lfo: [0.05 + rnd() * rnd() * 4, rnd() * 0.5, rnd() < 0.3 ? rnd() * 0.3 : 0], glide: rnd() < 0.4 ? rnd() * 0.15 : 0, drive: rnd() * 0.6,
        filter: Math.floor(rnd() * 4), wave: rnd() < 0.5 ? rnd() : 0, pwm: rnd() * 0.6,
        lfoShape: Math.floor(rnd() * 4), sync: rnd() < 0.4 ? 1 + Math.floor(rnd() * 8) : 0, retrig: rnd() < 0.5,
      },
      chorus: kind === "synth" && rnd() < 0.4 ? 1 + Math.floor(rnd() * 5) : 0,
      gain: keep[P.GAIN], pan: keep[P.PAN], vel: keep[P.VEL],
    });
  }
  const ratios = [0.5, 1, 1, 2, 2, 3, 4, 5, 7, 1.41, 2.73];
  const ops: PatchSpec["ops"] = {};
  for (let op = 0; op < OPS; op++) {
    const carrierish = op === 0;
    ops[op as 0] = [
      carrierish ? 1 : pick(ratios),
      carrierish ? 0.8 + rnd() * 0.2 : rnd() * 0.6,
      kind === "drum" ? 0.0005 : 0.002 + rnd() * rnd() * 0.6,
      kind === "drum" ? 0.04 + rnd() * 0.4 : 0.1 + rnd() * 1.5,
      kind === "drum" ? 0 : rnd() * 0.8,
      0.05 + rnd() * (kind === "drum" ? 0.1 : 0.8),
    ];
  }
  return patch({
    ops,
    algo: Math.floor(rnd() * 4),
    fb: rnd() * 0.5,
    pitch: kind === "drum" ? [rnd() * 24, 0.01 + rnd() * 0.1] : [0, 0.05],
    noise: kind === "drum" ? [rnd() * 0.6, 0.02 + rnd() * 0.2, rnd()] : [0, 0.05, 0.5],
    gain: keep[P.GAIN], pan: keep[P.PAN], vel: keep[P.VEL],
  });
}
