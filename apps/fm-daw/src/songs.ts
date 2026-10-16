// Songs: whole projects to start from. Every sound is this app's own FM patch,
// written here, so the songs ship under the repo's license with no samples.
import { patch, demoProject } from "./presets.ts";
import { GROOVES, KITS, applyGroove, applyKit } from "./drums.ts";
import type { Note, Project } from "./project.ts";

// A late-night spy-jazz feel at drum and bass tempo: one bass line in four
// phrases carries the loop and everything else waits its turn. The keys hit on the
// downbeat of the two main phrases and tease the turnaround; the horn says
// four notes in eight bars. Room to breathe is the point.
const A = 21;
// The bass, four two-bar phrases of [beat, length, semitones above A, velocity].
// Short notes punch; long ones open up into a womp.
const BASS: [number, number, number, number][][] = [
  // the riff: A A B A C A D C
  [[0, 0.45, 0, 1], [1, 0.45, 0, 0.75], [2, 0.45, 2, 0.75], [3, 0.45, 0, 0.75], [4, 0.45, 3, 0.8], [5, 0.45, 0, 0.75], [6, 0.45, 5, 0.8], [7, 0.45, 3, 0.75]],
  // a long womp, then a blue run answers it
  [[0, 1.5, 0, 1], [2, 0.4, 3, 0.7], [2.5, 0.4, 5, 0.7], [3, 0.4, 6, 0.8], [3.5, 0.4, 5, 0.7], [4, 2, 3, 0.95], [6.5, 0.4, 0, 0.7], [7, 0.75, -2, 0.8]],
  // the riff a fourth up, on D
  [[0, 0.45, 5, 1], [1, 0.45, 5, 0.75], [2, 0.45, 7, 0.75], [3, 0.45, 5, 0.75], [4, 0.45, 8, 0.8], [5, 0.45, 5, 0.75], [6, 1.25, 10, 0.9]],
  // turnaround: womps falling into E
  [[0, 2, 0, 1], [2.5, 1, 12, 0.85], [4, 1.5, 7, 0.95], [6, 0.4, 8, 0.75], [6.5, 0.4, 7, 0.75], [7, 0.4, 6, 0.75], [7.5, 0.4, 5, 0.7]],
];
const AM9 = [55, 59, 60, 64];
const D13 = [54, 59, 60, 64];
const E7S9 = [56, 60, 62, 67];
// [beat, length, voicing, velocity]
const KEYS: [number, number, number[], number][] = [[0, 3, AM9, 0.85], [16, 3, D13, 0.8], [30.5, 1, E7S9, 0.6]];
// [beat, length, midi, velocity]: a C thrown into the delay, then one blue lick
const HORN: [number, number, number, number][] = [[14.5, 0.375, 72, 0.8], [20.5, 0.5, 76, 0.75], [21, 0.5, 75, 0.7], [21.5, 2, 72, 0.75]];

/** Dark, chill liquid drum and bass at 172: a spy-jazz bass line in four phrases, half-time drums, and keys and horn only on the big moments. */
export function nightShift(): Project {
  const base = { ...demoProject(), bars: 8 };
  const p = applyKit(applyGroove(base, GROOVES.find((g) => g.name === "Late night")!), KITS[1]);
  const bass: Note[] = [];
  BASS.forEach((phrase, i) => { for (const [s, l, m, v] of phrase) bass.push({ s: i * 8 + s, l, m: A + m, v }); });
  const keys: Note[] = KEYS.flatMap(([s, l, ms, v]) => ms.map((m) => ({ s, l, m, v })));
  const lead: Note[] = HORN.map(([s, l, m, v]) => ({ s, l, m, v }));
  const tracks = p.tracks.slice();
  // Two pairs, notes down at A0. 1+2: a clean sine sub an octave up (A1, so
  // speakers can play it). 3+4: the growl, its modulator at 1.5x with feedback
  // swelling in slowly, so long notes womp open and short ones just punch.
  tracks[5] = { ...tracks[5], name: "Growl bass", root: A, notes: bass, params: patch({
    ops: { 0: [2, 1, 0.003, 0.9, 0.85, 0.08], 1: [2, 0.06, 0.003, 0.3, 0.05, 0.08],
           2: [2, 0.6, 0.003, 0.8, 0.7, 0.1], 3: [3, 0.85, 0.16, 0.6, 0.35, 0.12] },
    algo: 1, fb: 0.4, gain: 0.85, vel: 0.5 }) };
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
