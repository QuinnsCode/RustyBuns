// Song mode: the loop cut into slots of one length, each slot playing a pattern (A to H), so a song is a chain like
// A A B A C. The timeline is still one long loop (the sequencer, the grid, the playhead and recording see nothing new);
// the chain only links the slots: an edit in one copy of a pattern lands in every copy of it. That goes for a track's
// notes and its automation lanes, and for Shape's moves on the master. A pattern is what its first slot holds, so taking
// the last copy of a pattern out of the chain lets it go (undo brings it back).
import { arr, int, obj, type Of } from "@rustybuns/util/guard";
import type { Lane, Note } from "./project.ts";

export const PATTERNS = 8;
export const MAX_CHAIN = 64;
/** The letter a pattern goes by. */
export const letter = (k: number) => String.fromCharCode(65 + k);

/** `bars`: one slot's length; `chain`: the pattern each slot plays, in order. The loop is bars × chain slots long. */
export const Chain = arr(int(0, PATTERNS - 1), MAX_CHAIN, { min: 1 });
export const Song = obj({ bars: int(1, 512), chain: Chain });
export type Song = Of<typeof Song>;

/** Something on the timeline: the beat it sits at, and itself moved by `by` beats and cut at beat `end` (after the move). */
interface Timed<T> { at(x: T): number; moved(x: T, by: number, end: number): T }
const NOTE: Timed<Note> = { at: (n) => n.s, moved: (n, by, end) => ({ ...n, s: n.s + by, l: Math.min(n.l, end - n.s - by) }) };
/** One automation point, on lane `i`. A point right on a slot's end starts the next slot, as a note there would. */
interface Point { i: number; b: number; v: number }
const POINT: Timed<Point> = { at: (p) => p.b, moved: (p, by) => ({ ...p, b: p.b + by }) };

/** What sits in one slot (`beats` long, starting at `from`), moved to start at 0 and cut at the slot's end. */
const slice = <T>(kind: Timed<T>, xs: readonly T[], from: number, beats: number): T[] =>
  xs.filter((x) => kind.at(x) >= from && kind.at(x) < from + beats).map((x) => kind.moved(x, -from, beats));

const same = <T>(a: readonly T[], b: readonly T[]) => JSON.stringify(a) === JSON.stringify(b);

/** Each pattern in the chain as its first slot holds it (`null` for a letter the chain doesn't use). */
function patternsOf<T>(kind: Timed<T>, xs: readonly T[], song: Song, beats: number): (T[] | null)[] {
  const out: (T[] | null)[] = Array.from({ length: PATTERNS }, () => null);
  song.chain.forEach((k, j) => { out[k] ??= slice(kind, xs, j * beats, beats); });
  return out;
}

/** The whole chain: each slot a copy of its pattern. */
const chained = <T>(kind: Timed<T>, patterns: readonly (readonly T[] | null)[], song: Song, beats: number): T[] =>
  song.chain.flatMap((k, j) => (patterns[k] ?? []).map((x) => kind.moved(x, j * beats, Infinity)));

/** Each pattern as chain `was` held it, laid out along `song`. With `was` the same song, every slot plays its pattern again. */
const relayout = <T>(kind: Timed<T>, xs: readonly T[], was: Song, song: Song, beatsPerBar: number): T[] =>
  chained(kind, patternsOf(kind, xs, was, was.bars * beatsPerBar), song, song.bars * beatsPerBar);

/** Edited on the timeline (`now`, from `was`) and linked again: each pattern takes the first of its slots that changed. */
function relinked<T>(kind: Timed<T>, was: readonly T[], now: readonly T[], song: Song, beatsPerBar: number): T[] {
  const beats = song.bars * beatsPerBar, before = patternsOf(kind, was, song, beats), after = before.slice(), moved = new Set<number>();
  song.chain.forEach((k, j) => {
    if (moved.has(k)) return;
    const got = slice(kind, now, j * beats, beats);
    if (!same(got, before[k] ?? [])) { after[k] = got; moved.add(k); }
  });
  return chained(kind, after, song, beats);
}

/** Lanes as points, in lane then beat order, and back (a lane per `i`, in that order). */
const pointsOf = (lanes: readonly Lane[]): Point[] =>
  lanes.flatMap((l) => l.pts.map(([b, v]) => ({ i: l.i, b, v }))).sort((a, b) => a.i - b.i || a.b - b.b);
function lanesOf(points: readonly Point[]): Lane[] {
  const by = new Map<number, [number, number][]>();
  for (const p of [...points].sort((a, b) => a.i - b.i || a.b - b.b)) {
    const pts = by.get(p.i) ?? [];
    pts.push([p.b, p.v]);
    by.set(p.i, pts);
  }
  return [...by].map(([i, pts]) => ({ i, pts }));
}

/** One track's notes, each pattern as chain `was` held it, laid out along `song`. */
export const relayoutNotes = (notes: readonly Note[], was: Song, song: Song, beatsPerBar: number) => relayout(NOTE, notes, was, song, beatsPerBar);
/** A track's notes edited on the timeline, linked again: a note drawn in the third A lands in every A. */
export const relink = (was: readonly Note[], now: readonly Note[], song: Song, beatsPerBar: number) => relinked(NOTE, was, now, song, beatsPerBar);
/** Automation lanes (a track's, or Shape's), each pattern as chain `was` held it, laid out along `song`. */
export const relayoutLanes = (lanes: readonly Lane[], was: Song, song: Song, beatsPerBar: number) => lanesOf(relayout(POINT, pointsOf(lanes), was, song, beatsPerBar));
/** Automation lanes edited on the timeline, linked again: a filter sweep drawn in one A plays in every A. */
export const relinkLanes = (was: readonly Lane[], now: readonly Lane[], song: Song, beatsPerBar: number) =>
  lanesOf(relinked(POINT, pointsOf(was), pointsOf(now), song, beatsPerBar));

/** The next letter the chain doesn't use yet (the last one once all are in use). */
export function freshPattern(song: Song): number {
  for (let k = 0; k < PATTERNS; k++) if (!song.chain.includes(k)) return k;
  return PATTERNS - 1;
}
