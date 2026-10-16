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
// The womp bass, four two-bar phrases of [beat, length, semitones above A, velocity].
// Long notes only: each one swells open and keeps turning slowly while it holds.
const BASS: [number, number, number, number][][] = [
  [[0, 3.5, 0, 1], [4, 1.5, 3, 0.85], [6, 2, 5, 0.9]],
  [[0, 5.5, 0, 1], [6, 2, -2, 0.85]],
  [[0, 3.5, 5, 1], [4, 4, 8, 0.9]],
  [[0, 3.5, 0, 1], [4, 4, 7, 0.95]],
];
// The brass, a pair panned hard apart: dotted trap stabs in octaves, only in
// bars 3-4 and 7-8. [beat, length, semitones above A3, velocity]
const A3 = 57;
const BRASS: [number, number, number, number][] = [
  [8, 0.3, 0, 1], [8.75, 0.3, 0, 0.7], [9.5, 0.3, 3, 0.8], [11, 0.3, 5, 0.85],
  [12, 0.3, 3, 0.9], [12.75, 0.3, 0, 0.7], [13.5, 0.3, -2, 0.8], [15, 0.9, 0, 0.95],
  [24, 0.3, 7, 1], [24.75, 0.3, 7, 0.7], [25.5, 0.3, 8, 0.8], [27, 0.3, 7, 0.85],
  [28, 0.3, 5, 0.9], [28.75, 0.3, 3, 0.75], [29.5, 0.3, 2, 0.8], [31, 0.9, 7, 0.95],
];
const HAAS = 0.02; // beats the right twin trails by, about 7 ms
const AM9 = [55, 59, 60, 64];
const D13 = [54, 59, 60, 64];
const E7S9 = [56, 60, 62, 67];
// [beat, length, voicing, velocity]
const KEYS: [number, number, number[], number][] = [[0, 3, AM9, 0.85], [16, 3, D13, 0.8], [30.5, 1, E7S9, 0.6]];
// [beat, length, midi, velocity]: a C thrown into the delay, then one blue lick
const HORN: [number, number, number, number][] = [[14.5, 0.375, 72, 0.8], [20.5, 0.5, 76, 0.75], [21, 0.5, 75, 0.7], [21.5, 2, 72, 0.75]];

/** Dark, chill liquid drum and bass at 172: long womp bass, half-time drums, wide trap brass stabs, and keys and horn only on the big moments. */
export function nightShift(): Project {
  const base = { ...demoProject(), bars: 8 };
  const p = applyKit(applyGroove(base, GROOVES.find((g) => g.name === "Late night")!), KITS[1]);
  const bass: Note[] = [];
  BASS.forEach((phrase, i) => { for (const [s, l, m, v] of phrase) bass.push({ s: i * 8 + s, l, m: A + m, v }); });
  const keys: Note[] = KEYS.flatMap(([s, l, ms, v]) => ms.map((m) => ({ s, l, m, v })));
  const lead: Note[] = HORN.map(([s, l, m, v]) => ({ s, l, m, v }));
  const brass = (delay: number): Note[] => BRASS.flatMap(([s, l, m, v]) => [0, 12].map((o) => ({ s: s + delay, l, m: A3 + m + o, v })));
  const tracks = p.tracks.slice();
  // The shaker and ride sit this one out; their tracks become the brass pair.
  // FM brass: the modulator's attack trails the carrier's, so each stab blats
  // open; feedback adds the buzz. The twins are detuned apart and panned hard.
  const brassPatch = (detune: number, pan: number) => patch({
    ops: { 0: [1, 1, 0.012, 0.5, 0.6, 0.15], 1: [1, 0.55, 0.03, 0.25, 0.4, 0.12],
           2: [detune, 0.6, 0.012, 0.5, 0.6, 0.15], 3: [2, 0.2, 0.03, 0.2, 0.2, 0.12] },
    algo: 1, fb: 0.25, gain: 0.34, pan, vel: 0.6 });
  tracks[3] = { ...tracks[3], name: "Brass L", kind: "synth", root: A3, notes: brass(0), params: brassPatch(1.004, -0.85) };
  tracks[4] = { ...tracks[4], name: "Brass R", kind: "synth", root: A3, notes: brass(HAAS), params: brassPatch(0.996, 0.85) };
  // Two pairs, notes down at A0. 1+2: a clean sine sub an octave up (A1, so
  // speakers can play it). 3+4: the growl. Its modulator opens slowly, and at
  // 3.004x it drifts against the carrier, so a held note's tone turns over
  // about every 9 seconds: a long, slow LFO without one.
  tracks[5] = { ...tracks[5], name: "Womp bass", root: A, notes: bass, params: patch({
    ops: { 0: [2, 1, 0.003, 0.9, 0.85, 0.08], 1: [2, 0.06, 0.003, 0.3, 0.05, 0.08],
           2: [2, 0.6, 0.004, 1.5, 0.75, 0.3], 3: [3.004, 0.8, 0.45, 2.5, 0.5, 0.35] },
    algo: 1, fb: 0.35, gain: 0.65, vel: 0.4 }) };
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
