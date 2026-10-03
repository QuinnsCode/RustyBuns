// The default kit and a demo groove. Every sound is the same 4-op FM voice;
// drums lean on the pitch envelope and noise, synths on the algorithm.
import { NPARAMS, OPS, P, clampParam } from "./engine/params.ts";
import type { Note, Project, TrackDoc } from "./project.ts";

type OpSpec = [ratio: number, level: number, attack: number, decay: number, sustain: number, release: number];
interface PatchSpec {
  ops: Partial<Record<0 | 1 | 2 | 3, OpSpec>>;
  algo?: number; fb?: number;
  pitch?: [amount: number, decay: number];
  noise?: [level: number, decay: number, tone: number];
  gain?: number; pan?: number; vel?: number;
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
  return p.map((v, i) => clampParam(i, v));
}

export const KIT: { name: string; kind: "drum" | "synth"; root: number; params: number[] }[] = [
  { name: "Kick", kind: "drum", root: 33, params: patch({
    ops: { 0: [1, 1, 0.0005, 0.5, 0, 0.08], 1: [1, 0.22, 0.0005, 0.04, 0, 0.03] },
    pitch: [30, 0.07], noise: [0.08, 0.008, 1], gain: 0.95, vel: 0.4 }) },
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
    gain: 0.6, vel: 0.5 }) },
  { name: "Keys", kind: "synth", root: 60, params: patch({
    ops: { 0: [1, 1, 0.002, 1.4, 0.25, 0.35], 1: [1, 0.3, 0.002, 1.0, 0.1, 0.3],
           2: [1, 0.55, 0.002, 1.1, 0.2, 0.35], 3: [14, 0.12, 0.001, 0.12, 0, 0.1] },
    algo: 1, gain: 0.45, pan: 0.2, vel: 0.7 }) },
  { name: "Pad", kind: "synth", root: 60, params: patch({
    ops: { 0: [1, 0.8, 0.5, 1.5, 0.8, 1.2], 1: [2, 0.18, 0.6, 2, 0.6, 1.2],
           2: [1.004, 0.7, 0.5, 1.5, 0.8, 1.2], 3: [3, 0.12, 0.8, 2, 0.5, 1.2] },
    algo: 1, fb: 0.15, gain: 0.3, pan: -0.2, vel: 0.3 }) },
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
  return { v: 1, bpm: 118, swing: 0.12, bars, tracks };
}

/** Random but tame: levels and feedback capped, envelopes short-ish, gain kept. */
export function randomPatch(kind: "drum" | "synth", keep: number[], rnd: () => number = Math.random): number[] {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
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
