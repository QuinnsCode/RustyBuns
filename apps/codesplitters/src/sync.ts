// Turns a harness's plain-text edit into line ops. A CLI agent edits a file on
// disk; the file's Durable Object only takes ops that name lines by id. So we
// diff the text the agent left against the snapshot it started from, and map
// the changes back to ids: a changed line keeps its id (so blame still says
// who wrote the line), a removed line is a delete, a new line is an insert.

import type { Doc, Line, Op } from "./lines.ts";

/**
 * Ops that turn `base` (the snapshot the agent started from, with ids and revs)
 * into `next` (the text the agent left). Ops are in apply order.
 */
export function diffToOps(base: Line[], next: string[]): Op[] {
  const pairs = keptPairs(base.map((l) => l.text), next);
  pairs.push({ i: base.length, j: next.length }); // sentinel: the end of both

  const ops: Op[] = [];
  let anchor: string | null = null; // id of the last base line before this gap
  let prevI = -1, prevJ = -1;
  for (const { i, j } of pairs) {
    const old = base.slice(prevI + 1, i), fresh = next.slice(prevJ + 1, j);
    const paired = Math.min(old.length, fresh.length);
    for (let t = 0; t < paired; t++) ops.push({ kind: "set", line: old[t]!.id, base: old[t]!.rev, text: fresh[t]! });
    if (paired > 0) anchor = old[paired - 1]!.id;
    for (let t = paired; t < old.length; t++) ops.push({ kind: "delete", line: old[t]!.id, base: old[t]!.rev });
    // All inserts go after the same anchor, so emit them last-first to land in text order.
    for (let t = fresh.length - 1; t >= paired; t--) ops.push({ kind: "insert", after: anchor, text: fresh[t]! });
    if (i < base.length) anchor = base[i]!.id;
    prevI = i;
    prevJ = j;
  }
  return ops;
}

/**
 * Keep only the ops whose target is still as the snapshot had it. A line another
 * agent has since changed (its rev moved) or removed is skipped, and so is an
 * insert whose anchor line is gone. Everything else lands in one batch.
 */
export function rebase(ops: Op[], doc: Doc): { ops: Op[]; skipped: Op[] } {
  const rev = new Map(doc.lines.map((l) => [l.id, l.rev]));
  const keep: Op[] = [], skipped: Op[] = [];
  for (const op of ops) {
    const ok = op.kind === "insert" ? op.after === null || rev.has(op.after) : rev.get(op.line) === op.base;
    (ok ? keep : skipped).push(op);
  }
  return { ops: keep, skipped };
}

/**
 * Pairs of (base index, next index) for lines the two texts share, in order: a
 * longest common subsequence, found with Myers' linear-space diff. Memory is
 * O(n + m) and time O((n + m) * d) for d changed lines, so a big file with a
 * small edit is cheap and no file is too big to keep its line ids.
 */
export function keptPairs(a: string[], b: string[]): { i: number; j: number }[] {
  const pairs: { i: number; j: number }[] = [];
  const size = a.length + b.length + 2;
  const vf = new Int32Array(2 * size + 1), vb = new Int32Array(2 * size + 1);
  split(a, b, 0, a.length, 0, b.length, vf, vb, pairs);
  return pairs;
}

/** Match a[aLo..aHi) against b[bLo..bHi), pushing kept pairs in order. */
function split(a: string[], b: string[], aLo: number, aHi: number, bLo: number, bHi: number, vf: Int32Array, vb: Int32Array, out: { i: number; j: number }[]) {
  // A shared head and tail are kept as is; only the middle needs searching.
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) out.push({ i: aLo++, j: bLo++ });
  let tail = 0;
  while (aLo < aHi - tail && bLo < bHi - tail && a[aHi - 1 - tail] === b[bHi - 1 - tail]) tail++;
  aHi -= tail;
  bHi -= tail;
  if (aLo < aHi && bLo < bHi) {
    const [x, y, u, v] = middleSnake(a, b, aLo, aHi, bLo, bHi, vf, vb);
    split(a, b, aLo, x, bLo, y, vf, vb, out);
    for (let t = 0; t < u - x; t++) out.push({ i: x + t, j: y + t });
    split(a, b, u, aHi, v, bHi, vf, vb, out);
  }
  for (let t = 0; t < tail; t++) out.push({ i: aHi + t, j: bHi + t });
}

/**
 * The middle snake of the shortest edit path from a[aLo..aHi) to b[bLo..bHi):
 * searched from both ends at once until the two meet. Returns its start and end
 * as [x, y, u, v] in absolute indices. Both ranges are non-empty and differ at
 * their first and last lines, so the path splits into two smaller ones.
 */
function middleSnake(a: string[], b: string[], aLo: number, aHi: number, bLo: number, bHi: number, vf: Int32Array, vb: Int32Array): [number, number, number, number] {
  const n = aHi - aLo, m = bHi - bLo, delta = n - m, odd = (delta & 1) === 1;
  const off = n + m + 1; // diagonal k lives at index k + off
  vf[off + 1] = 0;
  vb[off + 1] = 0;
  for (let d = 0, max = Math.ceil((n + m) / 2); d <= max; d++) {
    // Forward: furthest x reached on each diagonal k = x - y.
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && vf[off + k - 1]! < vf[off + k + 1]!) ? vf[off + k + 1]! : vf[off + k - 1]! + 1;
      let y = x - k;
      const x0 = x, y0 = y;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) { x++; y++; }
      vf[off + k] = x;
      const c = delta - k; // the same diagonal, counted from the end
      if (odd && c >= -(d - 1) && c <= d - 1 && x + vb[off + c]! >= n) return [aLo + x0, bLo + y0, aLo + x, bLo + y];
    }
    // Backward: the same, walking from the ends of both ranges.
    for (let c = -d; c <= d; c += 2) {
      let x = c === -d || (c !== d && vb[off + c - 1]! < vb[off + c + 1]!) ? vb[off + c + 1]! : vb[off + c - 1]! + 1;
      let y = x - c;
      const x0 = x, y0 = y;
      while (x < n && y < m && a[aHi - 1 - x] === b[bHi - 1 - y]) { x++; y++; }
      vb[off + c] = x;
      const k = delta - c;
      if (!odd && k >= -d && k <= d && x + vf[off + k]! >= n) return [aHi - x, bHi - y, aHi - x0, bHi - y0];
    }
  }
  throw new Error("unreachable: the two searches always meet");
}
