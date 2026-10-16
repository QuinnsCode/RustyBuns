// Songs: whole projects to start from. Every sound is this app's own FM patch,
// written here, so the songs ship under the repo's license with no samples.
import { patch, demoProject } from "./presets.ts";
import { GROOVES, KITS, applyGroove, applyKit } from "./drums.ts";
import type { Note, Project } from "./project.ts";

// A late-night spy-jazz feel at drum and bass tempo: one bass riff carries
// the whole loop and everything else waits its turn. The keys hit on the
// downbeat of the two main phrases and tease the turnaround; the horn says
// four notes in eight bars. Room to breathe is the point.
const A = 33;
// The riff, two bars of quarter notes, short with air between: A A B A C A D C.
const RIFF = [0, 0, 2, 0, 3, 0, 5, 3];
const AM9 = [55, 59, 60, 64];
const E7S9 = [56, 60, 62, 67];
// [beat, length, voicing, velocity]
const KEYS: [number, number, number[], number][] = [[0, 3, AM9, 0.85], [16, 3, AM9, 0.8], [30.5, 1, E7S9, 0.6]];
// [beat, length, midi, velocity]: a C thrown into the delay, then one blue lick
const HORN: [number, number, number, number][] = [[14.5, 0.375, 72, 0.8], [20.5, 0.5, 76, 0.75], [21, 0.5, 75, 0.7], [21.5, 2, 72, 0.75]];

/** Dark, chill liquid drum and bass at 172: a spy-jazz bass riff, half-time drums, and keys and horn only on the big moments. */
export function nightShift(): Project {
  const base = { ...demoProject(), bars: 8 };
  const p = applyKit(applyGroove(base, GROOVES.find((g) => g.name === "Late night")!), KITS[1]);
  const bass: Note[] = [];
  for (let b = 0; b < 32; b++) bass.push({ s: b, l: 0.45, m: A + RIFF[b % 8], v: b % 8 === 0 ? 1 : 0.75 });
  const keys: Note[] = KEYS.flatMap(([s, l, ms, v]) => ms.map((m) => ({ s, l, m, v })));
  const lead: Note[] = HORN.map(([s, l, m, v]) => ({ s, l, m, v }));
  const tracks = p.tracks.slice();
  // Two pairs. 1+2: a clean sine sub. 3+4: the same note an octave up, driven
  // hard with feedback, its modulator swelling in and settling back on every
  // hit: the growl lives in the low mids, not the sub.
  tracks[5] = { ...tracks[5], name: "Growl bass", root: A, notes: bass, params: patch({
    ops: { 0: [1, 1, 0.003, 0.9, 0.85, 0.08], 1: [1, 0.06, 0.003, 0.3, 0.05, 0.08],
           2: [2, 0.55, 0.003, 0.6, 0.6, 0.08], 3: [1.5, 0.75, 0.06, 0.35, 0.45, 0.1] },
    algo: 1, fb: 0.45, gain: 0.85, vel: 0.5 }) };
  // FM electric piano: a tine pair and a bell pair with a quick 14x click.
  tracks[6] = { ...tracks[6], name: "Keys", root: 60, notes: keys, params: patch({
    ops: { 0: [1, 1, 0.002, 2, 0.35, 0.6], 1: [1, 0.32, 0.002, 0.9, 0.1, 0.5],
           2: [1, 0.5, 0.002, 1.6, 0.25, 0.6], 3: [14, 0.1, 0.001, 0.08, 0, 0.05] },
    algo: 1, gain: 0.42, pan: -0.2, vel: 0.7 }) };
  // A muted horn: a quick brassy bite from the modulator, slightly detuned twin.
  tracks[7] = { ...tracks[7], name: "Horn", root: 72, notes: lead, params: patch({
    ops: { 0: [1, 1, 0.02, 0.6, 0.7, 0.3], 1: [1, 0.38, 0.03, 0.35, 0.3, 0.25],
           2: [1.003, 0.45, 0.02, 0.6, 0.6, 0.3], 3: [2, 0.12, 0.03, 0.3, 0.2, 0.25] },
    algo: 1, fb: 0.1, gain: 0.48, pan: 0, vel: 0.5 }) };
  return { ...p, bpm: 172, swing: 0.2, space: 0.5, tracks };
}

export const SONGS: { name: string; make: () => Project }[] = [
  { name: "Demo groove", make: demoProject },
  { name: "Night Shift (liquid)", make: nightShift },
];
