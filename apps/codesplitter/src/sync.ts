// Layout: an agent's text edit to line ops: a Myers diff that keeps line ids, and a rebase onto the file as it is now
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
  slideDown(pairs, next);

  const ops: Op[] = [];
  let anchor: string | null = null; // id of the last base line before this gap
  let prevI = -1, prevJ = -1;
  for (const { i, j } of pairs) {
    const old = base.slice(prevI + 1, i), fresh = next.slice(prevJ + 1, j);
    // A changed line keeps the id of the old line it's most like, not just the next one in order.
    const from = pairUp(old.map((l) => l.text), fresh), kept = new Set(from);
    for (let t = 0; t < old.length; t++) if (!kept.has(t)) ops.push({ kind: "delete", line: old[t]!.id, base: old[t]!.rev });
    // New lines between two kept ones all go after the same anchor, so emit them last-first to land in text order.
    let run: string[] = [];
    const flush = () => { for (const text of run.reverse()) ops.push({ kind: "insert", after: anchor, text }); run = []; };
    fresh.forEach((text, t) => {
      const o = old[from[t]!];
      if (!o) { run.push(text); return; }
      flush();
      ops.push({ kind: "set", line: o.id, base: o.rev, text });
      anchor = o.id;
    });
    flush();
    if (i < base.length) anchor = base[i]!.id;
    prevI = i;
    prevJ = j;
  }
  return ops;
}

/**
 * A block of new lines that repeats the lines under it (a new test after the
 * last one: both end in `expect(…)`, `});` and a blank) could be read as added
 * a few lines higher, inside the test before it. Slide each one as far down as
 * it goes, so two sides that added a block at the end of one section both add
 * it at the same spot, whole. In place, on `pairs` with its end sentinel.
 */
function slideDown(pairs: { i: number; j: number }[], next: string[]) {
  for (let k = 0; k < pairs.length - 1; k++) {
    const prev = k ? pairs[k - 1]! : { i: -1, j: -1 };
    let start = prev.j + 1;
    // Only lines added: no base line in this gap.
    if (pairs[k]!.i !== prev.i + 1 || pairs[k]!.j === start) continue;
    while (k < pairs.length - 1 && next[start] === next[pairs[k]!.j]) {
      // The base line now keeps the block's first line, and the block moves down one.
      pairs[k] = { i: pairs[k]!.i, j: start++ };
      if (pairs[k + 1]!.i !== pairs[k]!.i + 1) break;
      k++;
    }
  }
}

/** How alike two lines are, 0 to 1: the words they share (Dice's coefficient). */
export function alike(a: string, b: string): number {
  if (a === b) return 1;
  const x = new Set(a.match(/\w+/g)), y = new Set(b.match(/\w+/g));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return (2 * both) / (x.size + y.size);
}

/**
 * Which old line each new line of a gap rewrote (-1: none, it's new). As many
 * pairs as the shorter side has lines, in order, the most alike overall (ties
 * go to the earliest), so a line added above a changed one doesn't take its
 * id. A huge gap pairs by position, as it's mostly a rewrite anyway.
 */
function pairUp(old: string[], fresh: string[]): number[] {
  const n = Math.min(old.length, fresh.length);
  if (old.length === fresh.length || !n || old.length * fresh.length > 40_000) return fresh.map((_, t) => t < n ? t : -1);
  const [xs, ys] = old.length < fresh.length ? [old, fresh] : [fresh, old];
  // best[a][b]: the most alike pairing of xs[0..a) into ys[0..b), each x paired.
  const best = Array.from({ length: xs.length + 1 }, () => new Float64Array(ys.length + 1).fill(-Infinity));
  best[0]!.fill(0);
  for (let a = 1; a <= xs.length; a++) for (let b = a; b <= ys.length; b++) best[a]![b] = Math.max(best[a]![b - 1]!, best[a - 1]![b - 1]! + alike(xs[a - 1]!, ys[b - 1]!));
  const to = new Array<number>(xs.length);
  for (let a = xs.length, b = ys.length; a > 0; b--) {
    if (b > a && best[a]![b - 1]! >= best[a - 1]![b - 1]! + alike(xs[a - 1]!, ys[b - 1]!)) continue;
    to[--a] = b - 1;
  }
  const from = fresh.map(() => -1);
  to.forEach((y, x) => { if (xs === old) from[y] = x; else from[x] = y; });
  return from;
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
 * `theirs`' changes to `base`, made on `ours` instead: a three-way merge by
 * lines. Each change lands where the lines it replaces (and their neighbours)
 * are still as `base` had them in `ours`. A change that touches a line `ours`
 * changed is a clash, and then nothing is merged: null.
 */
export function merge3(base: string[], ours: string[], theirs: string[]): string[] | null {
  const kept = new Map(keptPairs(base, ours).map(({ i, j }) => [i, j]));
  // Where base line k sits in ours; before the start and past the end always line up.
  const at = (k: number) => k < 0 ? -1 : k >= base.length ? ours.length : kept.get(k);
  const hunks: { from: number; to: number; lines: string[] }[] = [];
  let i = 0, j = 0;
  for (const p of [...keptPairs(base, theirs), { i: base.length, j: theirs.length }]) {
    if (p.i > i || p.j > j) {
      // base[i..p.i) became theirs[j..p.j): it, and the line either side, must be untouched in ours.
      for (let k = i - 1; k < p.i; k++) {
        const x = at(k), y = at(k + 1);
        if (x === undefined || y === undefined || y !== x + 1) return null;
      }
      hunks.push({ from: at(i - 1)! + 1, to: at(p.i)!, lines: theirs.slice(j, p.j) });
    }
    i = p.i + 1;
    j = p.j + 1;
  }
  const out = [...ours];
  for (const h of hunks.reverse()) out.splice(h.from, h.to - h.from, ...h.lines);
  return out;
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
