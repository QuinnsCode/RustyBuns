// Turns a harness's plain-text edit into line ops. A CLI agent edits a file on
// disk; the file's Durable Object only takes ops that name lines by id. So we
// diff the text the agent left against the snapshot it started from, and map
// the changes back to ids: a changed line keeps its id (so blame still says
// who wrote the line), a removed line is a delete, a new line is an insert.

import type { Doc, Line, Op } from "./lines.ts";

/** Above this many cells the LCS table is too big; the diff then treats the file as all-new. */
const MAX_CELLS = 4_000_000;

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

/** Pairs of (base index, next index) for lines the two texts share, in order (LCS). */
function keptPairs(a: string[], b: string[]): { i: number; j: number }[] {
  const n = a.length, m = b.length;
  if (n * m > MAX_CELLS) return [];
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: { i: number; j: number }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push({ i, j }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}
