// The piano roll's edits, as plain arithmetic on notes: draw, move, stretch either end, cut. A note's start and
// length are any number of beats; `snap` (beats, or null for free) only says where an edit may land. No DOM: the
// roll (src/ui/PianoRoll.tsx) calls these from its pointer and key handlers, and a test tries them.
import type { Note } from "./project.ts";

/** The shortest note the project keeps (sanitizeNotes). */
export const MIN_LEN = 1 / 64;
/** Beats to a millionth, so a free note doesn't save sixteen digits. */
const tidy = (b: number) => Math.round(b * 1e6) / 1e6;
const fit = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** A beat on the nearest line of the grid, or as it is with snap off. */
export const snapBeat = (b: number, snap: number | null) => tidy(snap ? Math.round(b / snap) * snap : b);

/**
 * A note drawn from beat `a` to beat `b` (either way round) in a window `span` beats long. On the grid it fills
 * the cells the drag crossed, one at least. Free, it is exactly the drag; a press with no drag is `dflt` long.
 */
export function drawNote(a: number, b: number, m: number, snap: number | null, span: number, dflt: number, v = 0.8): Note {
  let lo = fit(Math.min(a, b), 0, span), hi = fit(Math.max(a, b), 0, span);
  if (snap) { lo = Math.floor(lo / snap + 1e-9) * snap; hi = Math.max(Math.ceil(hi / snap - 1e-9) * snap, lo + snap); }
  else if (hi - lo < MIN_LEN) hi = lo + dflt;
  const s = fit(lo, 0, Math.max(span - MIN_LEN, 0));
  return { s: tidy(s), l: tidy(fit(hi - s, MIN_LEN, Math.max(span - s, MIN_LEN))), m: fit(Math.round(m), 0, 127), v };
}

/** The note `beats` later and `semis` higher; with snap its start lands on the grid. It keeps its length. */
export function moveNote(n: Note, beats: number, semis: number, snap: number | null, span: number): Note {
  return { ...n, s: fit(snapBeat(n.s + beats, snap), 0, Math.max(tidy(span - MIN_LEN), 0)), m: fit(Math.round(n.m + semis), 0, 127) };
}

/** The note ending on beat `end` (its start stays). */
export function stretchEnd(n: Note, end: number, snap: number | null): Note {
  let e = snapBeat(end, snap);
  // on the grid a note can't be squeezed to nothing: it stops one line after its start
  if (snap && e <= n.s + 1e-9) e = snapBeat(Math.floor(n.s / snap + 1e-9) * snap + snap, null);
  return { ...n, l: tidy(Math.max(e - n.s, MIN_LEN)) };
}

/** The note starting on beat `start` (its end stays where it sounds now). */
export function stretchStart(n: Note, start: number, snap: number | null): Note {
  const end = n.s + n.l;
  let s = Math.max(snapBeat(start, snap), 0);
  if (snap && s >= end - 1e-9) s = Math.max(Math.ceil(end / snap - 1e-9) * snap - snap, 0);
  s = Math.min(s, end - MIN_LEN);
  return { ...n, s: tidy(s), l: tidy(end - s) };
}

/** The note cut in two at beat `at`, or just the note when the cut misses it or would leave a sliver. */
export function cutNote(n: Note, at: number): Note[] {
  if (!(at >= n.s + MIN_LEN && at <= n.s + n.l - MIN_LEN)) return [n];
  const c = tidy(at);
  return [{ ...n, l: tidy(c - n.s) }, { ...n, s: c, l: tidy(n.s + n.l - c) }];
}

/** Every note in `notes` that beat `at` crosses, cut there (a cut down the whole roll). */
export const cutAll = (notes: Note[], at: number) => notes.flatMap((n) => cutNote(n, at));

/** Where note `n` is in `notes` now (the list may have changed under a drag), or -1. */
export const findNote = (notes: readonly Note[], n: Note) => notes.findIndex((x) => x.s === n.s && x.m === n.m && x.l === n.l && x.v === n.v);
