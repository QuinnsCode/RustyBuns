// The piano roll's edits, as plain arithmetic on notes: draw, erase, trim either end, move. A note's start and
// length are any number of beats; `snap` (beats, or null for free) only says where an edit may land. No DOM: the
// roll (src/ui/PianoRoll.tsx) calls these from its pointer and key handlers and from its desk_* commands, and a
// test tries them.
import type { Note } from "./project.ts";

/** The shortest note the project keeps (sanitizeNotes). */
export const MIN_LEN = 1 / 64;
/** Beats to a millionth, so a free note doesn't save sixteen digits. */
const tidy = (b: number) => Math.round(b * 1e6) / 1e6;
const fit = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** A beat on the nearest line of the grid, or as it is with snap off. */
export const snapBeat = (b: number, snap: number | null) => tidy(snap ? Math.round(b / snap) * snap : b);

/**
 * The pencil's note, drawn from beat `a` to beat `b` (either way round) in a window `span` beats long. On the grid
 * only its start lands on a line (the one at or before the press); its end is exactly where the pointer let go. A
 * press with no drag is `dflt` long.
 */
export function drawNote(a: number, b: number, m: number, snap: number | null, span: number, dflt: number, v = 0.8): Note {
  const lo = fit(Math.min(a, b), 0, span), hi = fit(Math.max(a, b), 0, span);
  const s = fit(snap ? Math.floor(lo / snap + 1e-9) * snap : lo, 0, Math.max(span - MIN_LEN, 0));
  const l = hi - lo < MIN_LEN ? dflt : hi - s;
  return { s: tidy(s), l: tidy(fit(l, MIN_LEN, Math.max(span - s, MIN_LEN))), m: fit(Math.round(m), 0, 127), v };
}

/**
 * The note `beats` later and `semis` higher; with snap its start lands on the grid. It keeps its length. A note
 * that starts before the window (a negative start, in a zoomed view) may stay that far back, no further.
 */
export function moveNote(n: Note, beats: number, semis: number, snap: number | null, span: number): Note {
  return { ...n, s: fit(snapBeat(n.s + beats, snap), Math.min(n.s, 0), Math.max(tidy(span - MIN_LEN), 0)), m: fit(Math.round(n.m + semis), 0, 127) };
}

/**
 * The note sounding from beat `start` to beat `end`: the edit popover's two thumbs. Both stay in the window (a start
 * already before it may stay there; an end already past it may stay there), and the end stays at least MIN_LEN after
 * the start: when they meet, the thumb that `moved` is the one that stops.
 */
export function trimNote(n: Note, start: number, end: number, span: number, moved: "start" | "end" = "end"): Note {
  const lo = Math.min(n.s, 0), hi = Math.max(span, n.s + n.l);
  let s = fit(start, lo, hi - MIN_LEN), e = fit(end, lo + MIN_LEN, hi);
  if (e - s < MIN_LEN) { if (moved === "start") s = e - MIN_LEN; else e = s + MIN_LEN; }
  return { ...n, s: tidy(s), l: tidy(e - s) };
}

/** `notes` with the one at `k` swapped for `now` (none, to take it off), or as they were when there is no `k`. */
export const editNotes = (notes: readonly Note[], k: number, now: Note[]): Note[] =>
  k >= 0 && k < notes.length ? [...notes.slice(0, k), ...now, ...notes.slice(k + 1)] : [...notes];

/** Where note `n` is in `notes` now (the list may have changed under a drag), or -1. */
export const findNote = (notes: readonly Note[], n: Note) => notes.findIndex((x) => x.s === n.s && x.m === n.m && x.l === n.l && x.v === n.v);
