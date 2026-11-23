// The drum grid's cells, kept apart from the page so the rules are plain functions (as roll.ts is for the
// piano roll). A note's start is any beat, so a cell holds the hits that start inside it, each with where it
// sits in the cell: a free hit is drawn where it is, not on its step.
import type { Note, TrackDoc } from "./project.ts";

/** The finest cell, a 16th; off-grid marks are against it at any zoom. */
export const FINE = 0.25;

export interface Cell {
  /** The loudest hit in the cell. */
  v: number;
  /** Some hit here is off the 16th grid (striped until quantized). */
  offGrid: boolean;
  /** Where each hit starts inside the cell, 0 (its step) to just under 1. */
  at: number[];
}

const cellOf = (n: Note, step: number) => Math.floor(n.s / step + 1e-6);

export function cellsFor(notes: Note[], steps: number, step: number): (Cell | null)[] {
  const cells: (Cell | null)[] = new Array(steps).fill(null);
  for (const n of notes) {
    // a hit from before the view (a long note reaching in) has no cell here
    if (n.s < -1e-6) continue;
    const s = Math.min(cellOf(n, step), steps - 1);
    const offGrid = Math.abs(n.s - Math.round(n.s / FINE) * FINE) > 1e-4;
    const at = Math.min(Math.max(n.s / step - s, 0), 0.999);
    const c = cells[s];
    cells[s] = { v: Math.max(c?.v ?? 0, n.v), offGrid: (c?.offGrid ?? false) || offGrid, at: [...(c?.at ?? []), at < 1e-4 ? 0 : at] };
  }
  return cells;
}

/**
 * A click on step `s`. An empty step gets a hit on it; shift adds an accented one, or flips the hits there
 * between accent and normal where they are. A plain click clears the step, except with Snap on, when hits
 * off the step move onto it first (the next click clears it).
 */
export function toggle(t: TrackDoc, s: number, step: number, opts: { accent?: boolean; snap?: boolean } = {}): Note[] {
  const inCell = (n: Note) => n.s > -1e-6 && cellOf(n, step) === s;
  const hit = t.notes.filter(inCell);
  if (!hit.length) return [...t.notes, { s: s * step, l: FINE, m: t.root, v: opts.accent ? 1 : 0.8 }];
  if (opts.accent) return t.notes.map((n) => (inCell(n) ? { ...n, v: n.v >= 0.95 ? 0.7 : 1 } : n));
  const on = s * step;
  if (opts.snap && hit.some((n) => Math.abs(n.s - on) > 1e-4)) return t.notes.map((n) => (inCell(n) ? { ...n, s: on } : n));
  return t.notes.filter((n) => !inCell(n));
}
