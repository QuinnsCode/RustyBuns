// A bank of synth sounds to load onto any track: the wobble and growl basses,
// the old-school ladder and chorus sounds, and minimal stabs. Each is a plain
// patch on the same two voices (src/engine/params.ts), so they're this repo's
// own and both engines play them alike. Loading one keeps the track's pan.
import { P } from "./engine/params.ts";
import { patch } from "./presets.ts";

export interface Sound { name: string; group: "Bass" | "Lead" | "Keys and pads" | "Minimal"; params: number[] }

const S = (name: string, group: Sound["group"], params: number[]): Sound => ({ name, group, params });

export const SOUNDS: Sound[] = [
  // half-time bass: ladder or vowel filters on a tempo-locked LFO that restarts each note
  S("Wobble bass", "Bass", patch({
    ops: { 0: [1, 1, 0.003, 0.5, 0.9, 0.08] },
    analog: { detune: 0.25, sub: 0.6, cutoff: 0.32, res: 0.55, lfo: [2, 0.55, 0], drive: 0.45,
      filter: 1, sync: 5, lfoShape: 0, retrig: true, fenv: [0, 0.001, 0.1] },
    gain: 0.5, send: 0 })),
  S("Talking growl", "Bass", patch({
    ops: { 0: [1, 1, 0.003, 0.4, 0.9, 0.06] },
    analog: { detune: 0.45, sub: 0.45, cutoff: 0.35, res: 0.7, lfo: [2, 0.5, 0], drive: 0.85,
      filter: 2, wave: 0.35, sync: 7, lfoShape: 1, retrig: true, fenv: [0.15, 0.001, 0.12] },
    gain: 0.7, send: 0 })),
  S("Reese", "Bass", patch({
    ops: { 0: [1, 1, 0.01, 1, 0.9, 0.15] },
    analog: { detune: 0.95, sub: 0.45, cutoff: 0.45, res: 0.2, lfo: [0.15, 0.08, 0], drive: 0.35, filter: 1, fenv: [0, 0.001, 0.1] },
    gain: 0.45, send: 0 })),
  S("FM growl", "Bass", patch({
    ops: { 0: [1, 1, 0.002, 0.6, 0.85, 0.08], 1: [1, 0.7, 0.002, 0.5, 0.6, 0.08], 2: [2, 0.4, 0.002, 0.4, 0.3, 0.08] },
    fb: 0.35, lfo: { depth: 0.8, sync: 6, shape: 2, retrig: true }, gain: 0.4, send: 0 })),
  S("Ladder bass", "Bass", patch({
    ops: { 0: [1, 1, 0.002, 0.35, 0.5, 0.08] },
    analog: { detune: 0.12, sub: 0.35, cutoff: 0.3, res: 0.6, fenv: [0.45, 0.001, 0.25], glide: 0.04, drive: 0.25, filter: 1 },
    gain: 0.5, send: 0 })),
  S("Acid line", "Bass", patch({
    ops: { 0: [1, 1, 0.002, 0.3, 0.4, 0.05] },
    analog: { detune: 0, sub: 0, cutoff: 0.35, res: 0.85, fenv: [0.5, 0.001, 0.18], glide: 0.06, drive: 0.5, filter: 1, wave: 0 },
    vel: 0.7, velTone: 0.5, gain: 0.4, send: 0.1 })),
  // a wavefolder before the ladder: the wave turns back on itself as the knob comes up
  S("Folded bass", "Bass", patch({
    ops: { 0: [1, 1, 0.002, 0.4, 0.7, 0.08] },
    analog: { detune: 0.1, sub: 0.5, cutoff: 0.5, res: 0.35, fenv: [0.2, 0.001, 0.2], drive: 0.2, filter: 1, lfo: [2, 0, 0], sync: 3 },
    fold: 0.45, gain: 0.45, send: 0 })),
  S("Sub", "Bass", patch({
    ops: { 0: [1, 1, 0.004, 1, 1, 0.1] },
    analog: { detune: 0, sub: 1, cutoff: 0.18, res: 0, filter: 1, fenv: [0, 0.001, 0.1] },
    gain: 0.55, send: 0 })),
  // leads
  S("Screech", "Lead", patch({
    ops: { 0: [1, 1, 0.005, 0.5, 0.8, 0.12] },
    analog: { detune: 0.6, sub: 0, cutoff: 0.62, res: 0.75, lfo: [6, 0.3, 0.15], drive: 0.9, filter: 2, wave: 0.6, pwm: 0.5, sync: 7 },
    gain: 0.3, send: 0.4 })),
  // seven saws (the supersaw): the big 90s trance lead and pad
  S("Supersaw lead", "Lead", patch({
    ops: { 0: [1, 1, 0.005, 0.8, 0.8, 0.3] },
    analog: { detune: 0.45, sub: 0.1, cutoff: 0.72, res: 0.1, fenv: [0.15, 0.005, 0.5] },
    supersaw: 0.6, chorus: 1, gain: 0.3, send: 0.5 })),
  S("Ladder lead", "Lead", patch({
    ops: { 0: [1, 1, 0.01, 0.6, 0.75, 0.25] },
    analog: { detune: 0.2, sub: 0.2, cutoff: 0.55, res: 0.45, fenv: [0.25, 0.01, 0.4], lfo: [5.5, 0, 0.25], glide: 0.05, drive: 0.3, filter: 1 },
    gain: 0.35, send: 0.4 })),
  // the 80s polysynth: pulses with PWM into the chorus
  S("Chorus pad", "Keys and pads", patch({
    ops: { 0: [1, 0.85, 0.6, 2, 0.85, 1.5] },
    analog: { detune: 0.1, sub: 0.2, cutoff: 0.55, res: 0.15, lfo: [0.4, 0.04, 0], wave: 0.7, pwm: 0.6, fenv: [0.1, 0.8, 2] },
    chorus: 2, gain: 0.3, send: 0.6 })),
  S("Supersaw pad", "Keys and pads", patch({
    ops: { 0: [1, 0.85, 0.5, 2, 0.85, 1.4] },
    analog: { detune: 0.3, sub: 0.1, cutoff: 0.6, res: 0.1, lfo: [0.3, 0.05, 0], fenv: [0.1, 0.6, 2] },
    supersaw: 0.8, chorus: 2, gain: 0.25, send: 0.65 })),
  S("PWM strings", "Keys and pads", patch({
    ops: { 0: [1, 0.85, 0.35, 2, 0.8, 0.9] },
    analog: { detune: 0.15, sub: 0, cutoff: 0.62, res: 0.1, lfo: [0.7, 0, 0.1], wave: 1, pwm: 0.75, fenv: [0.05, 0.3, 1.5] },
    chorus: 1, gain: 0.3, send: 0.5 })),
  S("Poly brass", "Keys and pads", patch({
    ops: { 0: [1, 0.9, 0.04, 0.8, 0.75, 0.3] },
    analog: { detune: 0.2, sub: 0, cutoff: 0.45, res: 0.15, fenv: [0.3, 0.06, 0.5], drive: 0.15 },
    chorus: 1, gain: 0.3, send: 0.35 })),
  S("Chorus keys", "Keys and pads", patch({
    ops: { 0: [1, 1, 0.002, 1.2, 0.3, 0.4] },
    analog: { detune: 0.08, sub: 0.15, cutoff: 0.48, res: 0.2, fenv: [0.35, 0.002, 0.6], wave: 0.5 },
    chorus: 3, vel: 0.7, velTone: 0.4, gain: 0.35, send: 0.4 })),
  // minimal: short, dry and percussive, built to be filtered live
  S("Minimal stab", "Minimal", patch({
    ops: { 0: [1, 1, 0.001, 0.18, 0, 0.08] },
    analog: { detune: 0.15, sub: 0, cutoff: 0.55, res: 0.5, fenv: [0.3, 0.001, 0.15], wave: 0.5, filter: 1 },
    chorus: 2, gain: 0.6, send: 0.5 })),
  S("Blip", "Minimal", patch({
    ops: { 0: [1, 1, 0.001, 0.12, 0, 0.05], 1: [2, 0.5, 0.001, 0.05, 0, 0.03] },
    gain: 0.35, send: 0.55 })),
  S("Dub chord", "Minimal", patch({
    ops: { 0: [1, 1, 0.002, 0.3, 0, 0.15] },
    analog: { detune: 0.2, sub: 0, cutoff: 0.5, res: 0.3, fenv: [0.2, 0.001, 0.2], wave: 0.3 },
    chorus: 1, gain: 0.3, send: 0.85 })),
];

/** A sound on a track: its patch, with the track's pan kept. */
export function loadSound(params: number[], s: Sound): number[] {
  const next = s.params.slice();
  next[P.PAN] = params[P.PAN];
  return next;
}
