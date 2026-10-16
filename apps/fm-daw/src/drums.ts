// The drum machine: grooves and kits for the five drum tracks. A groove is a
// bar or two of steps per lane, tiled across the loop, with an optional fill
// in the last bar. A kit swaps the five drum patches (and their names). Both
// return a new project, so one click is one undo.
import { KIT, patch } from "./presets.ts";
import type { Note, Project } from "./project.ts";

/** Lanes are the drum tracks in order: kick, snare, hat, then two the kit names. */
export const LANES = 5;
const STEP = 0.25;
/** X accent, x hit, o ghost, , whisper, . rest. */
const VEL: Record<string, number> = { X: 1, x: 0.78, o: 0.45, ",": 0.26 };

export interface Groove {
  name: string;
  /** Tempo it was written for; applying it moves the BPM there. */
  bpm: number;
  swing: number;
  /** Per lane, one string per bar (16 steps each), repeated across the loop. */
  lanes: string[][];
  /** Per lane, replaces that lane's last bar when the loop is 2 bars or more. */
  fill?: (string | null)[];
}

export const GROOVES: Groove[] = [
  {
    name: "Liquid roller", bpm: 174, swing: 0.24,
    lanes: [
      ["X.........X.....", "X.........x..x.."],
      ["....X..o....X...", "....X......oX.o."],
      ["x.o.x.oxx.o.x.o.", "x.o.x.o.x.oxx.o."],
      [",,o,,,o,,,o,,,o,"],
      ["..x...x...x...x."],
    ],
    fill: [null, "....X..o.oX.XoXo", null, null, "..x...x...x.X..."],
  },
  {
    name: "Late night", bpm: 172, swing: 0.2,
    lanes: [
      ["X.........x.....", "X..............."],
      ["........X.......", "........X......o"],
      ["x...x...x...x...", "x...x...x...o.x."],
      ["................"],
      ["................"],
    ],
  },
  {
    name: "Half-time", bpm: 172, swing: 0.04,
    lanes: [
      ["X......x..X.....", "X......x...x.x.."],
      ["........X.......", "........X.....o."],
      ["x.x.x.x.x.x.x.x."],
      [",.o.,.o.,.o.,.o."],
      ["....x.......x..."],
    ],
  },
  {
    name: "Chopped break", bpm: 170, swing: 0.1,
    lanes: [
      ["X.X.......XX....", "X.X.......X....."],
      ["....X..o.o..X..o", "....X..o.o..X.o."],
      ["x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.xox."],
      ["................"],
      ["x...x...x...x..."],
    ],
    fill: [null, "....X..o.oXoXoXX", null, null, null],
  },
  {
    name: "Steppers", bpm: 174, swing: 0.02,
    lanes: [
      ["X.....X...X.....", "X.....X...X...x."],
      ["....X.......X..."],
      ["xoxoxoxoxoxoxoxo"],
      ["..o...o...o...o."],
      ["................"],
    ],
  },
  {
    name: "Four on the floor", bpm: 122, swing: 0.12,
    lanes: [
      ["X...X...X...X..."],
      ["....x.......x..."],
      ["o.x.o.x.o.x.o.x."],
      ["............x..."],
      ["................", "...........x.x.."],
    ],
  },
];

/** The notes one lane plays across a loop of `bars`. */
export function laneNotes(g: Groove, lane: number, bars: number, root: number): Note[] {
  const out: Note[] = [];
  const pat = g.lanes[lane] ?? [];
  for (let bar = 0; bar < bars; bar++) {
    const fill = bars >= 2 && bar === bars - 1 ? g.fill?.[lane] : null;
    const row = fill ?? pat[bar % Math.max(pat.length, 1)] ?? "";
    for (let i = 0; i < 16; i++) {
      const v = VEL[row[i]];
      if (v) out.push({ s: (bar * 16 + i) * STEP, l: STEP, m: root, v });
    }
  }
  return out;
}

/** Writes the groove onto the drum tracks and moves tempo and swing to it. */
export function applyGroove(p: Project, g: Groove): Project {
  let lane = 0;
  const tracks = p.tracks.map((t) => (t.kind === "drum" && lane < LANES ? { ...t, notes: laneNotes(g, lane++, p.bars, t.root) } : t));
  return { ...p, bpm: g.bpm, swing: g.swing, tracks };
}

export interface DrumKit { name: string; drums: { name: string; root: number; params: number[] }[] }

const fmKit = (): DrumKit["drums"] => KIT.filter((k) => k.kind === "drum").map((k) => ({ name: k.name, root: k.root, params: k.params }));

export const KITS: DrumKit[] = [
  { name: "FM classic", drums: fmKit() },
  {
    name: "Liquid", drums: [
      { name: "Kick", root: 36, params: patch({
        ops: { 0: [1, 1, 0.0005, 0.32, 0, 0.06], 1: [1, 0.14, 0.0005, 0.03, 0, 0.03] },
        pitch: [24, 0.035], noise: [0.06, 0.005, 1], gain: 0.9, vel: 0.4 }) },
      { name: "Snare", root: 52, params: patch({
        ops: { 0: [1, 0.55, 0.0005, 0.12, 0, 0.05], 1: [1.48, 0.3, 0.0005, 0.06, 0, 0.04] },
        pitch: [9, 0.02], noise: [0.8, 0.24, 0.85], gain: 0.6, vel: 0.75 }) },
      { name: "Hat", root: 78, params: patch({
        ops: { 0: [1, 0.4, 0.0005, 0.03, 0, 0.03], 1: [1.41, 0.9, 0.0005, 0.04, 0, 0.03],
               2: [2.73, 0.8, 0.0005, 0.04, 0, 0.03], 3: [3.91, 0.7, 0.0005, 0.04, 0, 0.03] },
        fb: 0.6, noise: [0.5, 0.03, 1], gain: 0.5, pan: 0.35, vel: 0.85 }) },
      { name: "Shaker", root: 84, params: patch({
        ops: { 0: [1, 0.02, 0.0005, 0.03, 0, 0.03] },
        noise: [0.7, 0.05, 0.92], gain: 0.4, pan: 0.6, vel: 0.9 }) },
      { name: "Ride", root: 82, params: patch({
        ops: { 0: [1, 0.55, 0.0005, 1.1, 0, 0.6], 1: [2.76, 0.45, 0.0005, 0.8, 0, 0.5],
               2: [5.19, 0.3, 0.0005, 0.5, 0, 0.4] },
        fb: 0.2, noise: [0.12, 0.4, 1], gain: 0.2, pan: -0.55, vel: 0.7 }) },
    ],
  },
];

/** Swaps the drum patches. Notes move with their track's root, so the pattern keeps playing the drum. */
export function applyKit(p: Project, kit: DrumKit): Project {
  let lane = 0;
  const tracks = p.tracks.map((t) => {
    if (t.kind !== "drum" || lane >= kit.drums.length) return t;
    const d = kit.drums[lane++];
    return { ...t, name: d.name, root: d.root, params: d.params.slice(), notes: t.notes.map((n) => (n.m === t.root ? { ...n, m: d.root } : n)) };
  });
  return { ...p, tracks };
}
