// Song mode: the loop cut into slots of one length, each slot playing a pattern (A to H), so a song is a chain like
// A A B A C. The timeline is still one long loop (the sequencer, the grid, the playhead and recording see nothing new);
// the chain only links the slots: an edit in one copy of a pattern lands in every copy of it. A pattern is what its
// first slot holds, so taking the last copy of a pattern out of the chain lets it go (undo brings it back).
import { arr, int, obj, type Of } from "@rustybuns/util/guard";
import type { Note } from "./project.ts";

export const PATTERNS = 8;
export const MAX_CHAIN = 64;
/** The letter a pattern goes by. */
export const letter = (k: number) => String.fromCharCode(65 + k);

/** `bars`: one slot's length; `chain`: the pattern each slot plays, in order. The loop is bars × chain slots long. */
export const Chain = arr(int(0, PATTERNS - 1), MAX_CHAIN, { min: 1 });
export const Song = obj({ bars: int(1, 512), chain: Chain });
export type Song = Of<typeof Song>;

/** The notes of one slot (`beats` long, starting at `from`), moved to start at 0 and cut at the slot's end. */
function slice(notes: readonly Note[], from: number, beats: number): Note[] {
  return notes.filter((n) => n.s >= from && n.s < from + beats).map((n) => ({ ...n, s: n.s - from, l: Math.min(n.l, from + beats - n.s) }));
}

const same = (a: readonly Note[], b: readonly Note[]) => JSON.stringify(a) === JSON.stringify(b);

/** Each pattern in the chain as its first slot holds it, on one track (`null` for a letter the chain doesn't use). */
export function patternsOf(notes: readonly Note[], song: Song, beatsPerBar: number): (Note[] | null)[] {
  const beats = song.bars * beatsPerBar, out: (Note[] | null)[] = Array.from({ length: PATTERNS }, () => null);
  song.chain.forEach((k, j) => { out[k] ??= slice(notes, j * beats, beats); });
  return out;
}

/** One track's notes for the whole chain: each slot a copy of its pattern. */
export function chained(patterns: readonly (readonly Note[] | null)[], song: Song, beatsPerBar: number): Note[] {
  const beats = song.bars * beatsPerBar;
  return song.chain.flatMap((k, j) => (patterns[k] ?? []).map((n) => ({ ...n, s: n.s + j * beats })));
}

/**
 * A track edited on the timeline (`now`, from `was`), linked again: each pattern takes the first of its slots that
 * changed, and every slot then plays its pattern. A note drawn in the third A lands in every A.
 */
export function relink(was: readonly Note[], now: readonly Note[], song: Song, beatsPerBar: number): Note[] {
  const beats = song.bars * beatsPerBar, before = patternsOf(was, song, beatsPerBar), after = before.slice(), moved = new Set<number>();
  song.chain.forEach((k, j) => {
    if (moved.has(k)) return;
    const got = slice(now, j * beats, beats);
    if (!same(got, before[k] ?? [])) { after[k] = got; moved.add(k); }
  });
  return chained(after, song, beatsPerBar);
}

/** The next letter the chain doesn't use yet (the last one once all are in use). */
export function freshPattern(song: Song): number {
  for (let k = 0; k < PATTERNS; k++) if (!song.chain.includes(k)) return k;
  return PATTERNS - 1;
}
