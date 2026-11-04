// Words into the same index the pictures use. No model puts text and pixels in one space on
// Workers AI, so a tile's words are read once at index time (Clairic, see clairic.ts) and a
// question and those words meet here: each word, and each three-letter piece of it (so "price"
// still meets "prices" and a misread letter), is hashed to one of DIMS slots. The vector goes
// through the crate's 1-bit quantize like a tile's would, so the Hamming top-k we already have
// finds the tiles that share the question's words, and a cosine on the floats sorts the few.
import { DIMS, WORDS32 } from "../engine/layout.ts";
import { quantize, topk } from "../engine/twin.ts";

/** Words that say nothing about which tile holds the answer. */
const STOP = new Set("a an and are as at be by do does for from how i in is it its of on or the this to was what when where which who why with you your".split(" "));

/** FNV-1a, 32 bits. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The words of `text`, lower case, stop words left out. */
export function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w));
}

/** `text` as DIMS floats, unit length: a whole word weighs 2, each three-letter piece of one 1. */
export function wordVec(text: string, out: Float32Array<ArrayBufferLike> = new Float32Array(DIMS)): Float32Array<ArrayBufferLike> {
  out.fill(0);
  for (const w of words(text)) {
    out[hash(w) % DIMS]! += 2;
    const padded = ` ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) out[hash(`#${padded.slice(i, i + 3)}`) % DIMS]! += 1;
  }
  let n = 0;
  for (const v of out) n += v * v;
  if (n > 0) for (let i = 0; i < DIMS; i++) out[i]! /= Math.sqrt(n);
  return out;
}

/** Below this a hit is two words landing in one slot, not a word in common. */
export const MIN_OVERLAP = 0.1;

/** The vector's code for the index: a bit per slot that any word landed in. */
export function wordCode(vec: Float32Array<ArrayBufferLike>): Uint32Array {
  const code = new Uint32Array(WORDS32);
  quantize(vec, 1, DIMS, code);
  return code;
}

/** Cosine of two unit vectors: how much of the question a tile's words cover. */
export function overlap(a: Float32Array<ArrayBufferLike>, b: Float32Array<ArrayBufferLike>): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!;
  return d;
}

/**
 * The tiles' words, kept beside the picture index. Only tiles with words go in (a wordless code is
 * all zeros, and would sit closer to every short question than a tile that half matches), so
 * `tile` maps each entry back to its row in the picture index.
 */
export class WordIndex {
  readonly vecs: Float32Array;
  readonly codes: Uint32Array;
  readonly tile: number[] = [];
  constructor(capacity: number) {
    this.vecs = new Float32Array(capacity * DIMS);
    this.codes = new Uint32Array(capacity * WORDS32);
  }

  /** The tile at picture row `row` read as `text`; false when it had no words to keep. */
  add(row: number, text: string): boolean {
    const i = this.tile.length;
    if (!words(text).length || (i + 1) * DIMS > this.vecs.length) return false;
    const v = wordVec(text, this.vecs.subarray(i * DIMS, (i + 1) * DIMS));
    quantize(v, 1, DIMS, this.codes.subarray(i * WORDS32, (i + 1) * WORDS32));
    this.tile.push(row);
    return true;
  }

  /** The `k` tiles whose words best cover the question: a bit search for 64, rescored. A hash collision is not a match. */
  find(question: string, k: number): { row: number; score: number }[] {
    const q = wordVec(question);
    const idx = new Uint32Array(64), dist = new Uint32Array(64);
    const n = topk(this.codes, 0, this.tile.length, wordCode(q), 64, idx, dist);
    return Array.from(idx.subarray(0, n), (i) => ({ row: this.tile[i]!, score: overlap(q, this.vecs.subarray(i * DIMS, (i + 1) * DIMS)) }))
      .filter((h) => h.score >= MIN_OVERLAP)
      .sort((a, b) => b.score - a.score || a.row - b.row)
      .slice(0, k);
  }
}
