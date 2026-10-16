// Songs: whole projects to start from. Every sound is this app's own patch,
// written here, so the songs ship under the repo's license with no samples.
import { patch, demoProject } from "./presets.ts";
import { GROOVES, KITS, applyGroove, applyKit } from "./drums.ts";
import type { Lane, Note, Project, TrackDoc } from "./project.ts";

// Night Shift: dark liquid drum and bass at 172 in A minor, 32 bars, built to
// breathe. The two-step plays the whole way; around it an 8-bar cycle comes
// round four times and things arrive one at a time:
//   bars 1-8    drums, the womp bass, FM stabs into the reverb
//   bars 9-16   + long swelling horns
//   bars 17-24  + a trumpet with Spanish turns, thrown into the dub delay
//   bars 25-32  everything cuts for a beat, then the violin solo over the horns
// Automation does the long moves: the womp's filter and LFO open over the
// whole song, the stabs sink deeper into the reverb, and the cut is gain.
const BARS = 32;
const CYCLE = 32; // beats
const BEATS = BARS * 4;
const ENTER = { horns: 32, trumpet: 64, violin: 96 }; // beats
const CUT: [number, number] = [95, 96];

const at = (from: number, to = BEATS) => Array.from({ length: BEATS / CYCLE }, (_, i) => i * CYCLE).filter((c) => c >= from && c < to);

const A1 = 33;
// The womp bass, one cycle of [beat, length, semitones above A1, velocity]:
// six long notes with rests between. Velocity opens the filter.
const BASS: [number, number, number, number][] = [
  [0, 6, 0, 1], [8, 4, 0, 0.75], [13, 2.5, -2, 0.85], [16, 7, 5, 1], [24, 5, 0, 0.9], [29.5, 2.5, 7, 0.7],
];

// FM stabs: one chord on the downbeat of each phrase, a softer push after
// some, then the reverb carries them. [beat, voicing, velocity]
const AM9 = [55, 59, 60, 64];
const D13 = [54, 59, 60, 64];
const E7S9 = [56, 60, 62, 67];
const STABS: [number, number[], number][] = [
  [0, AM9, 1], [8, AM9, 0.7], [14.5, AM9, 0.45], [16, D13, 0.95], [24, E7S9, 0.85], [30.5, E7S9, 0.5],
];

// Horns: long open chords that swell in and hold, low and wide.
// [beat, length, voicing]
const HORNS: [number, number, number[]][] = [
  [0, 7.5, [45, 52, 57, 60]], [8, 4.75, [45, 52, 57, 60]], [13, 2.75, [43, 50, 55, 59]],
  [16, 7.5, [50, 57, 62, 65]], [24, 5.25, [45, 52, 57, 60]], [29.5, 2.5, [40, 47, 52, 56]],
];

// The trumpet: Spanish-flavoured lines in A harmonic minor (E Phrygian
// dominant over the E), half-step turns, a trill and the G# leading tone,
// left hanging for the dub delay. [beat, length, midi, velocity]
const trill = (b: number, len: number, lo: number, hi: number): [number, number, number, number][] =>
  Array.from({ length: Math.round(len / 0.125) }, (_, i) => [b + i * 0.125, 0.12, i % 2 ? hi : lo, 0.7]);
const TRUMPET: [number, number, number, number][] = [
  [2, 0.25, 76, 0.8], [2.25, 0.25, 77, 0.75], [2.5, 1.5, 76, 0.9], [4.5, 0.5, 80, 0.8], [5, 2, 81, 1],
  [18, 0.25, 72, 0.75], [18.25, 0.25, 71, 0.7], [18.5, 1.5, 72, 0.85],
  ...trill(26, 0.5, 76, 77), [26.5, 2, 76, 0.9], [29, 0.5, 74, 0.75], [29.5, 0.5, 72, 0.75], [30, 0.75, 71, 0.8], [31, 1, 68, 0.85],
];

// The violin solo: a pickup out of the cut, then long, rising lines that
// lean on the G#. [beat from the solo's first downbeat, length, midi, velocity]
const VIOLIN: [number, number, number, number][] = [
  [-0.5, 0.5, 76, 0.85], [0, 3, 81, 1], [3, 0.5, 80, 0.7], [3.5, 0.5, 81, 0.75], [4, 2, 83, 0.9], [6, 1, 84, 0.85], [7, 1, 83, 0.75],
  [8, 4, 81, 0.9], [12, 0.5, 77, 0.7], [12.5, 0.5, 76, 0.7], [13, 3, 80, 0.95],
  [16, 1, 86, 1], [17, 1, 84, 0.8], [18, 1, 83, 0.8], [19, 1, 81, 0.8], [20, 3, 88, 1], [23, 1, 86, 0.8],
  [24, 2, 84, 0.9], [26, 1, 83, 0.8], [27, 1, 80, 0.85], [28, 4, 81, 1],
];

const HAAS = 0.02; // beats the right horn trails by, about 7 ms
/** Gain held at `g`, dropped to nothing for the cut. */
const cutLane = (g: number): Lane => ({ i: 31, pts: [[0, g], [CUT[0], g], [CUT[0], 0], [CUT[1], 0], [CUT[1], g]] });

export function nightShift(): Project {
  const p = applyKit(applyGroove({ ...demoProject(), bars: BARS }, GROOVES[0]), KITS[1]);
  const notes = <T,>(from: number, to: number, xs: T[], f: (c: number, x: T) => Note | Note[]) => at(from, to).flatMap((c) => xs.flatMap((x) => f(c, x)));
  const bass = notes(0, BEATS, BASS, (c, [s, l, m, v]) => ({ s: c + s, l, m: A1 + m, v }));
  const stabs = notes(0, BEATS, STABS, (c, [s, ms, v]) => ms.map((m) => ({ s: c + s, l: 0.25, m, v })));
  const horns = (delay: number) => [...at(ENTER.horns, ENTER.trumpet), ...at(ENTER.violin)]
    .flatMap((c) => HORNS.flatMap(([s, l, ms]) => ms.map((m) => ({ s: c + s + delay, l, m, v: 0.8 }))));
  const trumpet = notes(ENTER.trumpet, ENTER.violin, TRUMPET, (c, [s, l, m, v]) => ({ s: c + s, l, m, v }));
  const violin = VIOLIN.map(([s, l, m, v]) => ({ s: ENTER.violin + s, l, m, v }));

  const tracks = p.tracks.slice();
  const set = (i: number, t: Partial<TrackDoc>) => { tracks[i] = { ...tracks[i], ...t }; };
  // The drums keep the liquid kit and the two-step, and drop out only for the cut.
  for (let d = 0; d < 5; d++) set(d, { auto: [cutLane(tracks[d].params[31])] });

  // The analog voice: two saws 18 cents apart beat against each other (the
  // moving low end), a sine sub under them, through a resonant low-pass. Its
  // envelope swells open on each note, harder notes open it further, and a
  // slow LFO keeps a held note turning. Over the song the cutoff climbs and
  // the LFO digs deeper. Dry.
  set(5, { name: "Womp bass", kind: "synth", root: A1, notes: bass, params: patch({
    ops: { 0: [1, 1, 0.004, 1.5, 0.85, 0.3] },
    analog: { detune: 0.36, sub: 0.45, cutoff: 0.32, res: 0.45, fenv: [0.35, 0.3, 1.2], lfo: [0.16, 0.15, 0], glide: 0.06, drive: 0.55 },
    gain: 0.3, vel: 0.3, send: 0, velTone: 0.5 }),
    auto: [{ i: 37, pts: [[0, 0.3], [BEATS, 0.46]] }, { i: 43, pts: [[0, 0.12], [BEATS, 0.45]] }, cutLane(0.3)] });

  // FM growl stabs: a snarling pair (modulator at 1.5x, with feedback) over a
  // cleaner one. Harder hits bite more; they sink deeper into Space as it goes.
  set(6, { name: "Stabs", kind: "synth", root: 60, notes: stabs, params: patch({
    ops: { 0: [1, 1, 0.003, 0.3, 0, 0.35], 1: [1, 0.12, 0.003, 0.2, 0, 0.3],
           2: [1, 0.6, 0.003, 0.3, 0, 0.35], 3: [1.5, 0.7, 0.02, 0.25, 0, 0.3] },
    algo: 1, fb: 0.35, gain: 0.45, vel: 0.5, send: 0.7, velTone: 0.7 }),
    auto: [{ i: 47, pts: [[0, 0.6], [BEATS, 1]] }, cutLane(0.45)] });

  // Trumpet on the analog voice: one saw through a low-pass that blats open
  // on every note, vibrato that comes in as the note holds, all into the dub delay.
  set(7, { name: "Trumpet", kind: "synth", root: 72, notes: trumpet, params: patch({
    ops: { 0: [1, 1, 0.015, 0.8, 0.8, 0.25] },
    analog: { detune: 0.08, sub: 0, cutoff: 0.5, res: 0.15, fenv: [0.45, 0.03, 0.4], lfo: [5.2, 0, 0.35], glide: 0.02, drive: 0.25 },
    gain: 0.3, pan: 0.15, vel: 0.5, send: 1, velTone: 0.4 }) });

  // Horns: FM brass whose modulator swells in slower than the note, so each
  // chord blooms; long release. A pair, detuned apart and panned hard.
  const horn = (detune: number, pan: number) => patch({
    ops: { 0: [1, 1, 0.45, 2, 0.85, 1.2], 1: [1, 0.42, 0.9, 2.5, 0.5, 1.2],
           2: [detune, 0.6, 0.5, 2, 0.85, 1.2], 3: [2, 0.14, 0.9, 2.5, 0.4, 1.2] },
    algo: 1, fb: 0.15, gain: 0.14, pan, vel: 0.2, send: 0.55 });
  set(8, { name: "Horns L", kind: "synth", root: 48, notes: horns(0), params: horn(1.004, -0.8), auto: [cutLane(0.14)] });
  set(9, { name: "Horns R", kind: "synth", root: 48, notes: horns(HAAS), params: horn(0.996, 0.8), auto: [cutLane(0.14)] });

  // The violin: a saw and bow noise through a resonant low-pass (the noise
  // is shaped by the filter, then the reverb does the rest), a slow bowed
  // attack, vibrato that grows into each note, harder bowing is brighter.
  set(10, { name: "Violin", kind: "synth", root: 72, notes: violin, params: patch({
    ops: { 0: [1, 1, 0.12, 2, 0.9, 0.45] },
    analog: { detune: 0.05, sub: 0, cutoff: 0.66, res: 0.4, fenv: [0.15, 0.2, 1.5], lfo: [5.6, 0, 0.55], glide: 0.04, drive: 0.1 },
    noise: [0.25, 0.5, 0.7], gain: 0.38, pan: -0.1, vel: 0.4, send: 0.9, velTone: 0.5 }) });
  set(11, { notes: [] });

  return { ...p, bpm: 172, swing: 0.2, space: 0.8, tracks: tracks.map((t) => ({ ...t, auto: t.auto ?? [] })) };
}

export const SONGS: { name: string; make: () => Project }[] = [
  { name: "Demo groove", make: demoProject },
  { name: "Night Shift (liquid)", make: nightShift },
];
