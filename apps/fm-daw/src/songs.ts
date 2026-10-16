// Songs: whole projects to start from. Every sound is this app's own FM patch,
// written here, so the songs ship under the repo's license with no samples.
import { patch, demoProject } from "./presets.ts";
import { GROOVES, KITS, applyGroove, applyKit } from "./drums.ts";
import type { Note, Project } from "./project.ts";

// A minor, low and dark: Am7, Fmaj7, Dm9, Em7, two bars each, eight bars round.
const CHORDS: { root: number; voicing: number[] }[] = [
  { root: 33, voicing: [45, 52, 55, 60] },
  { root: 29, voicing: [41, 52, 57, 60] },
  { root: 38, voicing: [38, 53, 57, 64] },
  { root: 40, voicing: [40, 50, 55, 59] },
];

// Call and response, two bars per chord. The call is a phrase in the first
// bar; the answer is one tone, E5 (in all four chords), thrown into the delay
// in the second bar so the repeats do the talking.
const CALLS: [number, number, number][][] = [
  [[0, 1.5, 64], [1.5, 0.5, 62], [2, 2, 60]],
  [[0, 1.5, 65], [1.5, 0.5, 64], [2, 2, 60]],
  [[0, 1, 62], [1, 0.5, 65], [1.5, 2.5, 69]],
  [[0, 1.5, 67], [1.5, 0.5, 65], [2, 1, 64], [3, 1, 59]],
];
const ANSWER = 76;
// The rolling bass, one bar of [beat, length, velocity]: velocity drives the growl.
const ROLL: [number, number, number][] = [[0, 0.6, 1], [0.75, 0.25, 0.55], [1.5, 0.5, 0.8], [2.5, 0.5, 0.9], [3.25, 0.25, 0.5]];
const ANSWER_AT: [number, number][] = [[0.5, 0.75], [1.75, 0.4]];

/** Liquid drum and bass at 174 in A minor: a swung two-step under a lead that calls and answers itself through the delay. */
export function nebulaDrift(): Project {
  const base = { ...demoProject(), bars: 8 };
  let p = applyKit(applyGroove(base, GROOVES[0]), KITS[1]);
  const sub: Note[] = [], drone: Note[] = [];
  CHORDS.forEach((c, i) => {
    const at = i * 8;
    for (let bar = 0; bar < 2; bar++) {
      const b = at + bar * 4;
      for (const [at16, l, v] of ROLL) sub.push({ s: b + at16, l, m: c.root, v });
      if (bar === 1) sub.push({ s: b + 3.75, l: 0.25, m: c.root + 12, v: 0.7 });
    }
    for (const m of c.voicing) drone.push({ s: at, l: 7.75, m, v: 0.7 });
  });
  const lead: Note[] = CALLS.flatMap((call, i) => [
    ...call.map(([s, l, m]) => ({ s: i * 8 + s, l, m, v: 0.75 })),
    ...ANSWER_AT.map(([s, v]) => ({ s: i * 8 + 4 + s, l: 0.375, m: ANSWER, v })),
  ]);
  const tracks = p.tracks.slice();
  // Two pairs: a carrier and its detuned twin beat against each other (the
  // moving, dark low end), each with a modulator that plucks a growl on the hit.
  tracks[5] = { ...tracks[5], name: "Roller bass", root: 33, notes: sub, params: patch({
    ops: { 0: [1, 1, 0.003, 0.8, 0.8, 0.08], 1: [1, 0.4, 0.002, 0.16, 0.08, 0.08],
           2: [1.006, 0.75, 0.003, 0.8, 0.75, 0.08], 3: [2, 0.22, 0.002, 0.22, 0.05, 0.08] },
    algo: 1, fb: 0.18, gain: 0.62, vel: 0.5 }) };
  tracks[6] = { ...tracks[6], name: "Halo lead", root: 60, notes: lead, params: patch({
    ops: { 0: [1, 1, 0.08, 1.6, 0.7, 1.2], 1: [1, 0.16, 0.35, 2.2, 0.35, 1.2],
           2: [2.003, 0.18, 0.45, 2.4, 0.55, 1.6], 3: [3.5, 0.05, 0.6, 2.5, 0.3, 1.4] },
    algo: 1, fb: 0.05, gain: 0.52, pan: 0, vel: 0.4 }) };
  tracks[7] = { ...tracks[7], name: "Nebula drone", root: 48, notes: drone, params: patch({
    ops: { 0: [1, 0.85, 1.8, 4, 0.85, 2.4], 1: [1, 0.08, 2.5, 5, 0.6, 2.4],
           2: [1.006, 0.75, 2.2, 4, 0.85, 2.4], 3: [2, 0.06, 3, 5, 0.5, 2.4] },
    algo: 1, gain: 0.2, pan: 0, vel: 0.2 }) };
  p = { ...p, swing: 0.26, space: 0.6, tracks };
  return p;
}

export const SONGS: { name: string; make: () => Project }[] = [
  { name: "Demo groove", make: demoProject },
  { name: "Nebula Drift (liquid)", make: nebulaDrift },
];
