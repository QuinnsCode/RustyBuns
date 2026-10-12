// Reviewing a branch a chunk at a time (#735). What a branch changed in a file
// is its copy against its fork point (the base), line by line: ids are stable
// and lines never move, so the two walk side by side, and every stretch where
// they differ is a hunk. A reviewer accepts a hunk (it stays) or rejects it:
// the branch's copy goes back to the base's text there, as ordinary ops, so
// blame says who rejected it. Pure functions; branches.ts serves them.

import type { Doc, Op } from "./lines.ts";

/** One stretch the branch changed: base lines it took out (or rewrote), and branch lines it put in. */
export interface Hunk {
  /** Stable while the stretch is unchanged: the first line id it touches. */
  key: string;
  /** Where it starts on the branch's copy (1-based), and on the base's. */
  at: number;
  from: number;
  del: { id: string; text: string }[];
  add: { id: string; text: string }[];
  /** The branch line just before it, unchanged on both sides (null: the top of the file). */
  before: string | null;
}

/** The branch's change to one file, as hunks. A stretch that reads the same as before (a rejected delete put back) isn't one. */
export function hunks(base: Doc, branch: Doc): Hunk[] {
  const inBase = new Set(base.lines.map((l) => l.id)), inBranch = new Set(branch.lines.map((l) => l.id));
  const out: Hunk[] = [];
  let cur: Hunk | null = null, before: string | null = null, i = 0, j = 0;
  const open = () => (cur ??= { key: "", at: j + 1, from: i + 1, del: [], add: [], before });
  const close = () => {
    if (!cur) return;
    cur.key = cur.del[0]?.id ?? cur.add[0]!.id;
    const same = cur.del.length === cur.add.length && cur.del.every((d, k) => d.text === cur!.add[k]!.text);
    if (!same) out.push(cur);
    else before = cur.add.at(-1)!.id;   // reads as it did: the next hunk goes back in after it
    cur = null;
  };
  while (i < base.lines.length || j < branch.lines.length) {
    const b = base.lines[i], r = branch.lines[j];
    if (b && r && b.id === r.id) {
      if (b.text === r.text) { close(); before = r.id; }
      else { open().del.push({ id: b.id, text: b.text }); cur!.add.push({ id: r.id, text: r.text }); }
      i++; j++;
    } else if (b && !inBranch.has(b.id)) { open().del.push({ id: b.id, text: b.text }); i++; }
    else if (r && !inBase.has(r.id)) { open().add.push({ id: r.id, text: r.text }); j++; }
    else break;   // the same ids in another order: lines don't move, so this can't happen
  }
  close();
  return out;
}

/**
 * Ops that put the branch's copy back to the base's text over one hunk: a
 * rewritten line gets its old text back, a line the branch added goes, and a
 * line it deleted comes back (as a new line: an id, once gone, stays gone).
 */
export function revertOps(branch: Doc, h: Hunk): Op[] {
  const rev = new Map(branch.lines.map((l) => [l.id, l.rev]));
  const kept = new Set(h.add.map((l) => l.id));
  const ops: Op[] = [];
  let anchor = h.before, next = branch.nextId;
  for (const l of h.add) if (!h.del.some((d) => d.id === l.id)) ops.push({ kind: "delete", line: l.id, base: rev.get(l.id)! });
  for (const d of h.del) {
    if (kept.has(d.id)) { ops.push({ kind: "set", line: d.id, text: d.text, base: rev.get(d.id)! }); anchor = d.id; continue; }
    ops.push({ kind: "insert", after: anchor, text: d.text });
    anchor = `L${next++}`;
  }
  return ops;
}
