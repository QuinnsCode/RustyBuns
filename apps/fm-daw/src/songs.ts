// Songs: whole projects to start from. Every sound is this app's own FM patch,
// written here, so the songs ship under the repo's license with no samples.
import { patch, demoProject } from "./presets.ts";
import { GROOVES, KITS, applyGroove, applyKit } from "./drums.ts";
import type { Note, Project } from "./project.ts";

// A minor with jazz in it: Am9, D13, Fmaj9#11, E7#9, two bars each. Rootless
// voicings around middle C, so only one or two notes move per change; the bass
// carries the roots.
const CHORDS: { root: number; voicing: number[] }[] = [
  { root: 33, voicing: [55, 59, 60, 64] },
  { root: 38, voicing: [54, 59, 60, 64] },
  { root: 29, voicing: [57, 59, 64, 67] },
  { root: 28, voicing: [56, 60, 62, 67] },
];

// Keys, two bars of [beat, length, velocity]: one held chord, one pushed answer. Room to breathe.
const COMP: [number, number, number][] = [[0, 3, 0.75], [5.5, 2, 0.55]];

// Call and response. The call is a lick in the first bar (blue notes and all);
// the answer is one tone, C5, thrown into the delay in the second bar so the
// repeats do the talking.
const CALLS: [number, number, number][][] = [
  [[0.5, 0.5, 76], [1, 0.5, 74], [1.5, 2, 69]],
  [[0.5, 0.5, 74], [1, 0.5, 75], [1.5, 2, 76]],
  [[0.5, 0.5, 76], [1, 0.5, 71], [1.5, 2, 72]],
  [[0.5, 0.5, 68], [1, 0.5, 71], [1.5, 2, 74]],
];
const ANSWER = 72;
const ANSWER_AT: [number, number][] = [[0.5, 0.8]];

// The rolling bass, one bar of [beat, length, velocity]: velocity drives the growl.
const ROLL: [number, number, number][] = [[0, 1.25, 1], [1.5, 0.5, 0.7], [2.5, 1, 0.9]];

/** Dark liquid drum and bass at 174: a swung two-step, a growling bass, jazz chords and a horn that answers itself, all with room to breathe. */
export function nightShift(): Project {
  const base = { ...demoProject(), bars: 8 };
  const p = applyKit(applyGroove(base, GROOVES[0]), KITS[1]);
  const bass: Note[] = [], keys: Note[] = [];
  CHORDS.forEach((c, i) => {
    const at = i * 8;
    for (let bar = 0; bar < 2; bar++) {
      const b = at + bar * 4;
      for (const [s, l, v] of ROLL) bass.push({ s: b + s, l, m: c.root, v });
    }
    for (const [s, l, v] of COMP) for (const m of c.voicing) keys.push({ s: at + s, l, m, v });
  });
  const lead: Note[] = CALLS.flatMap((call, i) => [
    ...call.map(([s, l, m]) => ({ s: i * 8 + s, l, m, v: 0.75 })),
    ...ANSWER_AT.map(([s, v]) => ({ s: i * 8 + 4 + s, l: 0.375, m: ANSWER, v })),
  ]);
  // Strip the kit back to kick, snare and hat: the shaker and ride sit this one out.
  const tracks = p.tracks.map((t, i) => (i === 3 || i === 4 ? { ...t, notes: [] } : t));
  // Two pairs. 1+2: a clean sine sub. 3+4: the same note an octave up, driven
  // hard with feedback, its modulator swelling in and settling back on every
  // hit: the growl lives in the low mids, not the sub.
  tracks[5] = { ...tracks[5], name: "Growl bass", root: 33, notes: bass, params: patch({
    ops: { 0: [1, 1, 0.003, 0.9, 0.85, 0.08], 1: [1, 0.06, 0.003, 0.3, 0.05, 0.08],
           2: [2, 0.55, 0.003, 0.6, 0.6, 0.08], 3: [1.5, 0.75, 0.06, 0.35, 0.45, 0.1] },
    algo: 1, fb: 0.45, gain: 0.9, vel: 0.55 }) };
  // FM electric piano: a tine pair and a bell pair with a quick 14x click.
  tracks[6] = { ...tracks[6], name: "Keys", root: 60, notes: keys, params: patch({
    ops: { 0: [1, 1, 0.002, 2, 0.35, 0.5], 1: [1, 0.32, 0.002, 0.9, 0.1, 0.4],
           2: [1, 0.5, 0.002, 1.6, 0.25, 0.5], 3: [14, 0.1, 0.001, 0.08, 0, 0.05] },
    algo: 1, gain: 0.38, pan: -0.25, vel: 0.7 }) };
  // A muted horn: a quick brassy bite from the modulator, slightly detuned twin.
  tracks[7] = { ...tracks[7], name: "Horn", root: 72, notes: lead, params: patch({
    ops: { 0: [1, 1, 0.02, 0.6, 0.7, 0.25], 1: [1, 0.38, 0.03, 0.35, 0.3, 0.2],
           2: [1.003, 0.45, 0.02, 0.6, 0.6, 0.25], 3: [2, 0.12, 0.03, 0.3, 0.2, 0.2] },
    algo: 1, fb: 0.1, gain: 0.42, pan: 0, vel: 0.5 }) };
  return { ...p, swing: 0.26, space: 0.45, tracks };
}

export const SONGS: { name: string; make: () => Project }[] = [
  { name: "Demo groove", make: demoProject },
  { name: "Night Shift (liquid)", make: nightShift },
];
