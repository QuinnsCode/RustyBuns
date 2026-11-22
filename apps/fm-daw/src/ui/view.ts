// The editors' view window: which stretch of the loop the drum grid and the
// piano roll show, as a start and a length in beats. Any float values; every
// function here keeps it inside the loop. Pure, so the gestures in
// Timeline.tsx and the tests share one set of rules.
import type { Note } from "../project.ts";

/** What the editors show: `from` beats into the loop, `span` beats long. */
export type View = { from: number; span: number };

/** The closest you can zoom in, beats. */
export const MIN_SPAN = 1;
/** The narrowest a grid cell gets before the grid coarsens, px. */
export const MIN_CELL_PX = 12;

/** The view kept inside a loop of `L` beats: span between MIN_SPAN (or the loop) and the loop, start so it ends by the loop end. */
export function clampView(v: View, L: number): View {
  const span = Math.min(Math.max(Number.isFinite(v.span) ? v.span : L, Math.min(MIN_SPAN, L)), L);
  const from = Math.min(Math.max(Number.isFinite(v.from) ? v.from : 0, 0), L - span);
  return { from, span };
}

/** The whole loop. */
export const fit = (L: number): View => ({ from: 0, span: L });

/** Scale the span by `factor` (under 1 zooms in) keeping the beat `at` where it is on screen. */
export function zoomAbout(v: View, L: number, factor: number, at: number): View {
  const span = Math.min(Math.max(v.span * factor, Math.min(MIN_SPAN, L)), L);
  const k = span / v.span;
  return clampView({ from: at - (at - v.from) * k, span }, L);
}

/** Slide the view by `beats` (negative: earlier). */
export const scrollBy = (v: View, L: number, beats: number): View => clampView({ from: v.from + beats, span: v.span }, L);

/**
 * The grid step for a view `px` wide: the finest of `finest` and the coarser
 * steps that divide the loop whose cells are at least MIN_CELL_PX, else the
 * coarsest. Zoomed out the grid thins; zoomed in it comes down to `finest`.
 */
export function gridFor(span: number, px: number, finest: number, L: number): number {
  const ladder = [finest, ...[0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128].filter((s) => s > finest + 1e-9 && Math.abs(L / s - Math.round(L / s)) < 1e-6)];
  const perBeat = px / Math.max(span, 1e-9);
  return ladder.find((s) => s * perBeat >= MIN_CELL_PX) ?? ladder[ladder.length - 1];
}

/** The view widened out to whole grid steps, so the editors' cells sit on the song's grid. */
export function snapView(v: View, step: number, L: number): View {
  const from = Math.max(Math.floor(v.from / step + 1e-9) * step, 0);
  const end = Math.min(Math.ceil((v.from + v.span) / step - 1e-9) * step, L);
  return { from, span: Math.max(end - from, Math.min(step, L - from)) };
}

/** A note shows in the view if any of it is inside: one that starts before but reaches in counts. */
export const inView = (n: Note, v: View) => n.s < v.from + v.span && n.s + n.l > v.from;

/**
 * A track's notes as the editors see them (starts relative to the view; one
 * that starts before it has a negative start, and the editor clips it), and
 * `back`, which maps the editor's edited list onto the whole track: notes
 * outside the view are kept as they were, notes the editor handed back
 * untouched are the originals exactly, and new or changed ones move back by
 * `from`.
 */
export function windowNotes(notes: Note[], v: View): { notes: Note[]; back(edited: Note[]): Note[] } {
  const origin = new Map<Note, Note>();
  const shown = notes.filter((n) => inView(n, v)).map((n) => {
    const w = { ...n, s: n.s - v.from };
    origin.set(w, n);
    return w;
  });
  return {
    notes: shown,
    back: (edited) => [
      ...notes.filter((n) => !inView(n, v)),
      ...edited.map((n) => origin.get(n) ?? { ...n, s: Math.round((n.s + v.from) * 1e6) / 1e6 }),
    ],
  };
}

/** Where the ruler puts numbers: every `every` beats, labelled as bars (or bar.beat when a beat gets its own). */
export function rulerMarks(v: View, px: number, beatsPerBar: number): { at: number; label: string; major: boolean }[] {
  const perBeat = px / Math.max(v.span, 1e-9);
  const every = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512].map((b) => b * beatsPerBar).find((b) => b * perBeat >= 44) ?? v.span;
  const step = perBeat * beatsPerBar < 44 ? every : perBeat >= 36 ? 1 : beatsPerBar;
  const out: { at: number; label: string; major: boolean }[] = [];
  for (let at = Math.ceil(v.from / step - 1e-9) * step; at < v.from + v.span - 1e-9 && out.length < 400; at += step) {
    const bar = Math.floor(at / beatsPerBar + 1e-9), beat = Math.round(at - bar * beatsPerBar);
    out.push({ at, label: beat === 0 ? String(bar + 1) : `${bar + 1}.${beat + 1}`, major: beat === 0 });
  }
  return out;
}
