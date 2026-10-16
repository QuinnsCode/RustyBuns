// The sounds and phrases the songs share: A minor, one 8-bar cycle (32 beats)
// of Am, Am/G, Dm, Am/E. Night Shift loops them; Long Trail arranges them
// across ten minutes. Every sound is a patch written here.
import { patch } from "./presets.ts";
import { P } from "./engine/params.ts";
import type { Note } from "./project.ts";

export const CYCLE = 32; // beats
export const A1 = 33;

/** [start, length, midi, velocity] */
export type Phrase = [number, number, number, number][];
export const toNotes = (ph: Phrase, at: number, scale = 1, transpose = 0): Note[] =>
  ph.map(([s, l, m, v]) => ({ s: at + s * scale, l: l * scale, m: m + transpose, v }));

// The womp bass: six long notes with rests between, semitones above A1.
export const BASS: Phrase = [
  [0, 6, A1, 1], [8, 4, A1, 0.75], [13, 2.5, A1 - 2, 0.85], [16, 7, A1 + 5, 1], [24, 5, A1, 0.9], [29.5, 2.5, A1 + 7, 0.7],
];

// Chords: one on the downbeat of each phrase, a softer push after some.
export const AM9 = [55, 59, 60, 64];
export const D13 = [54, 59, 60, 64];
export const E7S9 = [56, 60, 62, 67];
export const STABS: [number, number[], number][] = [
  [0, AM9, 1], [8, AM9, 0.7], [14.5, AM9, 0.45], [16, D13, 0.95], [24, E7S9, 0.85], [30.5, E7S9, 0.5],
];
export const stabNotes = (at: number): Note[] => STABS.flatMap(([s, ms, v]) => ms.map((m) => ({ s: at + s, l: 0.25, m, v })));

// Horns: long open chords that swell in and hold.
export const HORNS: [number, number, number[]][] = [
  [0, 7.5, [45, 52, 57, 60]], [8, 4.75, [45, 52, 57, 60]], [13, 2.75, [43, 50, 55, 59]],
  [16, 7.5, [50, 57, 62, 65]], [24, 5.25, [45, 52, 57, 60]], [29.5, 2.5, [40, 47, 52, 56]],
];
export const hornNotes = (at: number, v = 0.8): Note[] => HORNS.flatMap(([s, l, ms]) => ms.map((m) => ({ s: at + s, l, m, v })));

// Arpeggio tones per stretch of the cycle, for the pizzicato violin.
const ARPS: [number, number[]][] = [
  [0, [57, 64, 69, 72, 76, 72, 69, 64]], [13, [55, 62, 67, 71, 74, 71, 67, 62]],
  [16, [50, 57, 62, 65, 69, 65, 62, 57]], [24, [57, 64, 69, 72, 76, 72, 69, 64]], [29.5, [52, 59, 64, 68, 71, 68, 64, 59]],
];
/** Plucked arpeggios across one cycle, every `step` beats, an octave up with `up`. */
export function pizzNotes(at: number, step = 0.5, up = 0, from = 0, to = CYCLE): Note[] {
  const out: Note[] = [];
  let k = 0;
  for (let b = from; b < to; b += step, k++) {
    const tones = [...ARPS].reverse().find(([s]) => b >= s)![1];
    out.push({ s: at + b, l: step * 0.9, m: tones[k % tones.length] + up, v: b % 1 === 0 ? 0.9 : 0.6 });
  }
  return out;
}

// The trumpet: Spanish-flavoured lines in A harmonic minor (E Phrygian
// dominant over the E), half-step turns, a trill and the G# leading tone.
const trill = (b: number, len: number, lo: number, hi: number): Phrase =>
  Array.from({ length: Math.round(len / 0.125) }, (_, i) => [b + i * 0.125, 0.12, i % 2 ? hi : lo, 0.7]);
export const TRUMPET: Phrase = [
  [2, 0.25, 76, 0.8], [2.25, 0.25, 77, 0.75], [2.5, 1.5, 76, 0.9], [4.5, 0.5, 80, 0.8], [5, 2, 81, 1],
  [18, 0.25, 72, 0.75], [18.25, 0.25, 71, 0.7], [18.5, 1.5, 72, 0.85],
  ...trill(26, 0.5, 76, 77), [26.5, 2, 76, 0.9], [29, 0.5, 74, 0.75], [29.5, 0.5, 72, 0.75], [30, 0.75, 71, 0.8], [31, 1, 68, 0.85],
];

// The violin's two themes. A rises and leans on the G#; B sits higher and
// falls through the Dm. A starts with a pickup half a beat early.
export const VIOLIN_A: Phrase = [
  [-0.5, 0.5, 76, 0.85], [0, 3, 81, 1], [3, 0.5, 80, 0.7], [3.5, 0.5, 81, 0.75], [4, 2, 83, 0.9], [6, 1, 84, 0.85], [7, 1, 83, 0.75],
  [8, 4, 81, 0.9], [12, 0.5, 77, 0.7], [12.5, 0.5, 76, 0.7], [13, 3, 80, 0.95],
  [16, 1, 86, 1], [17, 1, 84, 0.8], [18, 1, 83, 0.8], [19, 1, 81, 0.8], [20, 3, 88, 1], [23, 1, 86, 0.8],
  [24, 2, 84, 0.9], [26, 1, 83, 0.8], [27, 1, 80, 0.85], [28, 4, 81, 1],
];
export const VIOLIN_B: Phrase = [
  [0, 1.5, 81, 1], [1.5, 0.5, 83, 0.75], [2, 2, 84, 0.9], [4, 1, 83, 0.8], [5, 1, 81, 0.8], [6, 2, 80, 0.9],
  [8, 3, 76, 0.85], [11, 1, 77, 0.75], [12, 4, 76, 0.9],
  [16, 2, 77, 0.9], [18, 1, 81, 0.8], [19, 1, 86, 0.95], [20, 4, 84, 1], [24, 2, 83, 0.85], [26, 2, 80, 0.85], [28, 2, 83, 0.9], [30, 2, 88, 1],
];

// ---- sounds ----

/** Analog womp: two saws 18 cents apart and a sub through a resonant low-pass that swells open per note; a slow LFO keeps held notes turning. Dry. */
export const womp = () => patch({
  ops: { 0: [1, 1, 0.004, 1.5, 0.85, 0.3] },
  analog: { detune: 0.36, sub: 0.45, cutoff: 0.32, res: 0.45, fenv: [0.35, 0.3, 1.2], lfo: [0.16, 0.15, 0], glide: 0.06, drive: 0.55 },
  gain: 0.3, vel: 0.3, send: 0, velTone: 0.5 });

/** FM growl stabs: a snarling pair (modulator at 1.5x, feedback) over a cleaner one, made for the reverb. */
export const stabs = () => patch({
  ops: { 0: [1, 1, 0.003, 0.3, 0, 0.35], 1: [1, 0.12, 0.003, 0.2, 0, 0.3],
         2: [1, 0.6, 0.003, 0.3, 0, 0.35], 3: [1.5, 0.7, 0.02, 0.25, 0, 0.3] },
  algo: 1, fb: 0.35, gain: 0.45, vel: 0.5, send: 0.7, velTone: 0.7 });

/** Analog trumpet: one saw through a low-pass that blats open, vibrato that comes in as it holds, all into the dub delay. */
export const trumpet = () => patch({
  ops: { 0: [1, 1, 0.015, 0.8, 0.8, 0.25] },
  analog: { detune: 0.08, sub: 0, cutoff: 0.5, res: 0.15, fenv: [0.45, 0.03, 0.4], lfo: [5.2, 0, 0.35], glide: 0.02, drive: 0.25 },
  gain: 0.3, pan: 0.15, vel: 0.5, send: 1, velTone: 0.4 });

/** FM horns: the modulator swells in slower than the note, so chords bloom. Use as a detuned pair panned apart. */
export const horn = (detune: number, pan: number) => patch({
  ops: { 0: [1, 1, 0.45, 2, 0.85, 1.2], 1: [1, 0.42, 0.9, 2.5, 0.5, 1.2],
         2: [detune, 0.6, 0.5, 2, 0.85, 1.2], 3: [2, 0.14, 0.9, 2.5, 0.4, 1.2] },
  algo: 1, fb: 0.15, gain: 0.14, pan, vel: 0.2, send: 0.55 });
export const HAAS = 0.02; // beats the right horn trails by, about 7 ms

/** Analog violin: a saw and bow noise through a resonant low-pass, a bowed attack, vibrato that grows into each note. */
export const violin = () => patch({
  ops: { 0: [1, 1, 0.12, 2, 0.9, 0.45] },
  analog: { detune: 0.05, sub: 0, cutoff: 0.66, res: 0.4, fenv: [0.15, 0.2, 1.5], lfo: [5.6, 0, 0.55], glide: 0.04, drive: 0.1 },
  noise: [0.25, 0.5, 0.7], gain: 0.38, pan: -0.1, vel: 0.4, send: 0.9, velTone: 0.5 });

/** The violin's envelope and bow, plucked or bowed: params to automate between the two. */
export const PIZZ: [number, number][] = [[P.attack(0), 0.002], [P.decay(0), 0.35], [P.sustain(0), 0], [P.release(0), 0.3], [P.NOISE, 0.06], [P.LFO_PITCH, 0], [P.CUTOFF, 0.6]];
export const ARCO: [number, number][] = [[P.attack(0), 0.12], [P.decay(0), 2], [P.sustain(0), 0.9], [P.release(0), 0.45], [P.NOISE, 0.25], [P.LFO_PITCH, 0.55], [P.CUTOFF, 0.66]];
