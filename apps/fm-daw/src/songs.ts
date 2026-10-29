// Songs: whole projects to start from. Every sound is this app's own patch
// (src/themes.ts), so the songs ship under the repo's license with no samples.
import { demoProject } from "./presets.ts";
import { GROOVES, KITS, applyGroove, applyKit } from "./drums.ts";
import { P } from "./engine/params.ts";
import { longTrail } from "./longtrail.ts";
import { SOUNDS } from "./sounds.ts";
import * as T from "./themes.ts";
import type { Lane, Note, Project, TrackDoc } from "./project.ts";

// Night Shift: dark liquid drum and bass at 172 in A minor, 32 bars: the loop
// version of Long Trail. The two-step plays the whole way; around it the
// 8-bar cycle comes round four times and things arrive one at a time:
//   bars 1-8    drums, the womp bass, FM stabs into the reverb
//   bars 9-16   + long swelling horns
//   bars 17-24  + a trumpet with Spanish turns, thrown into the dub delay
//   bars 25-32  everything cuts for a beat, then the violin solo over the horns
// Automation does the long moves: the womp's filter and LFO open over the
// whole loop, the stabs sink deeper into the reverb, and the cut is gain.
const BARS = 32;
const BEATS = BARS * 4;
const ENTER = { horns: 32, trumpet: 64, violin: 96 }; // beats
const CUT: [number, number] = [95, 96];

const at = (from: number, to = BEATS) => Array.from({ length: BEATS / T.CYCLE }, (_, i) => i * T.CYCLE).filter((c) => c >= from && c < to);
/** Gain held at `g`, dropped to nothing for the cut. */
const cutLane = (g: number): Lane => ({ i: P.GAIN, pts: [[0, g], [CUT[0], g], [CUT[0], 0], [CUT[1], 0], [CUT[1], g]] });

export function nightShift(): Project {
  const p = applyKit(applyGroove({ ...demoProject(), bars: BARS }, GROOVES[0]), KITS[1]);
  const tracks = p.tracks.slice();
  const put = (i: number, t: Partial<TrackDoc>) => { tracks[i] = { ...tracks[i], ...t }; };
  for (let d = 0; d < 5; d++) put(d, { auto: [cutLane(tracks[d].params[P.GAIN])] });
  const horns = (delay: number): Note[] => [...at(ENTER.horns, ENTER.trumpet), ...at(ENTER.violin)].flatMap((c) => T.hornNotes(c + delay));
  put(5, { name: "Womp bass", kind: "synth", root: T.A1, notes: at(0).flatMap((c) => T.toNotes(T.BASS, c)), params: T.womp(),
    auto: [{ i: P.CUTOFF, pts: [[0, 0.3], [BEATS, 0.46]] }, { i: P.LFO_CUT, pts: [[0, 0.12], [BEATS, 0.45]] }, cutLane(0.3)] });
  put(6, { name: "Stabs", kind: "synth", root: 60, notes: at(0).flatMap(T.stabNotes), params: T.stabs(),
    auto: [{ i: P.SEND, pts: [[0, 0.6], [BEATS, 1]] }, cutLane(0.45)] });
  put(7, { name: "Trumpet", kind: "synth", root: 72, notes: at(ENTER.trumpet, ENTER.violin).flatMap((c) => T.toNotes(T.TRUMPET, c)), params: T.trumpet() });
  put(8, { name: "Horns L", kind: "synth", root: 48, notes: horns(0), params: T.horn(1.004, -0.8), auto: [cutLane(0.14)] });
  put(9, { name: "Horns R", kind: "synth", root: 48, notes: horns(T.HAAS), params: T.horn(0.996, 0.8), auto: [cutLane(0.14)] });
  put(10, { name: "Violin", kind: "synth", root: 72, notes: T.toNotes(T.VIOLIN_A, ENTER.violin), params: T.violin() });
  put(11, { notes: [] });
  return { ...p, bpm: 172, swing: 0.2, space: 0.8, tracks: tracks.map((t) => ({ ...t, auto: t.auto ?? [] })) };
}

// Wobble Lab: half-time at 140 in F minor, 4 bars, to play over. The bass is
// the tempo-locked wobble; its LFO_SYNC is automated so it talks (1/8, 1/16,
// triplets, a held quarter) for three bars, then a vowel growl answers, under a
// chorus pad and an off-beat ladder stab.
// Hold V B N M to stutter it, bend and the mod wheel on a MIDI keyboard.
const sound = (name: string) => SOUNDS.find((x) => x.name === name)!.params.slice();
export function wobbleLab(): Project {
  const p = applyGroove({ ...demoProject(), bars: 4 }, GROOVES[2]);
  const tracks = p.tracks.slice();
  const put = (i: number, t: Partial<TrackDoc>) => { tracks[i] = { ...tracks[i], ...t }; };
  const roots = [29, 32, 25, 24]; // F, Ab, Db, C
  const chords = [[53, 56, 60], [51, 56, 60], [49, 53, 56], [48, 52, 55]];
  const bass: Note[] = roots.slice(0, 3).flatMap((m, b) => [
    { s: b * 4, l: 1.5, m, v: 0.9 }, { s: b * 4 + 2, l: 1.25, m, v: 0.8 }, { s: b * 4 + 3.5, l: 0.5, m: m + 12, v: 0.95 }]);
  // the wobble's rate per half bar: 1/8, 1/16, 1/8T, 1/4 ... (LFO_DIVS indices)
  const rates = [5, 7, 6, 5, 7, 5, 3, 8];
  const sync: [number, number][] = rates.flatMap((r, i) => [[i * 2, r], [i * 2 + 2, r]] as [number, number][]); // two points on a beat: a jump
  put(5, { name: "Wobble", kind: "synth", root: 29, notes: bass, params: sound("Wobble bass"), auto: [{ i: P.LFO_SYNC, pts: sync }] });
  put(6, { name: "Chorus pad", kind: "synth", root: 60, params: sound("Chorus pad"),
    notes: chords.flatMap((c, b) => c.map((m) => ({ s: b * 4, l: 3.9, m, v: 0.55 }))) });
  put(7, { name: "Stab", kind: "synth", root: 60, params: sound("Minimal stab"),
    notes: chords.flatMap((c, b) => [0.75, 2.75].flatMap((o) => c.map((m) => ({ s: b * 4 + o, l: 0.2, m: m + 12, v: 0.7 })))) });
  // bar 4 answers in the vowel growl: "oo-ah-ee" on 1/16 triangles
  put(8, { name: "Growl", kind: "synth", root: 29, params: sound("Talking growl"),
    notes: [{ s: 12, l: 1.5, m: 24, v: 0.9 }, { s: 14, l: 1, m: 24, v: 0.85 }, { s: 15.25, l: 0.75, m: 36, v: 1 }] });
  for (let i = 9; i < tracks.length; i++) put(i, { notes: [] });
  return { ...p, bpm: 140, swing: 0.08, space: 0.35, tracks: tracks.map((t) => ({ ...t, auto: t.auto ?? [] })) };
}

export const SONGS: { name: string; make: () => Project }[] = [
  { name: "Demo groove", make: demoProject },
  { name: "Night Shift (liquid loop)", make: nightShift },
  { name: "Long Trail (10 min)", make: longTrail },
  { name: "Wobble Lab (half-time, 140)", make: wobbleLab },
];
