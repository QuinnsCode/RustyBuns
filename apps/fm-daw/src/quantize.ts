// Quantize: pull note starts toward the grid. Strength 1 snaps, 0.5 keeps half
// the feel. Starts that round to the loop end wrap to 0. Exact duplicates
// (same start and pitch) collapse to the louder one.
import type { Note } from "./project.ts";

export const GRIDS = [
  { label: "1/4", beats: 1 },
  { label: "1/8", beats: 0.5 },
  { label: "1/16", beats: 0.25 },
  { label: "1/32", beats: 0.125 },
  { label: "1/8T", beats: 1 / 3 },
  { label: "1/16T", beats: 1 / 6 },
] as const;

export function quantizeNote(n: Note, grid: number, strength: number, loopBeats: number): Note {
  const target = Math.round(n.s / grid) * grid;
  let s = n.s + (target - n.s) * strength;
  if (s >= loopBeats - 1e-9) s -= loopBeats;
  if (s < 0) s = 0;
  return { ...n, s: Math.round(s * 1e6) / 1e6 };
}

export function quantize(notes: Note[], grid: number, strength: number, loopBeats: number): Note[] {
  const out = new Map<string, Note>();
  for (const n of notes) {
    const q = quantizeNote(n, grid, strength, loopBeats);
    const k = `${q.s}:${q.m}`;
    const prev = out.get(k);
    if (!prev || q.v > prev.v) out.set(k, q);
  }
  return [...out.values()].sort((a, b) => a.s - b.s || a.m - b.m);
}
