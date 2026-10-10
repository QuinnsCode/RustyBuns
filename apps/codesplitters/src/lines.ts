// A file is an ordered list of lines with stable ids, plus an append-only log
// of ops against those ids. Pure functions: the Durable Object owns the state,
// the tests and the agents demo drive these directly.
//
// Ops name lines by id, never by index, so two agents editing different lines
// never collide. Editing the same line is optimistic: `set` and `delete` carry
// the line's `base` rev, and a stale base is a conflict the caller retries.
// An edit that depends on other lines too (a rename, "is this ever
// reassigned?") passes `ifRev`: the whole file must still be at that rev.

import { keptPairs } from "./sync.ts";

export interface Line { id: string; text: string; by: string; rev: number }

export type Op =
  | { kind: "insert"; after: string | null; text: string }
  | { kind: "set"; line: string; text: string; base: number }
  | { kind: "delete"; line: string; base: number };

export interface Applied { rev: number; by: string; at: number; op: Op; line: string }

export interface Doc { rev: number; nextId: number; lines: Line[] }

export type Result = { ok: true; applied: Applied[] } | { ok: false; conflicts: { index: number; reason: string }[] };

export const empty = (): Doc => ({ rev: 0, nextId: 1, lines: [] });

/**
 * Apply a batch all-or-nothing. On success `doc` is mutated; on conflict it is
 * untouched. `by` is one author for the batch, or one per op (a merge keeps
 * each line's author).
 */
export function apply(doc: Doc, ops: Op[], by: string | string[], at = Date.now(), ifRev?: number): Result {
  if (ifRev !== undefined && ifRev !== doc.rev) return { ok: false, conflicts: [{ index: -1, reason: `file is at rev ${doc.rev}, not ${ifRev}` }] };
  const draft: Doc = { rev: doc.rev, nextId: doc.nextId, lines: doc.lines.map((l) => ({ ...l })) };
  const applied: Applied[] = [];
  const conflicts: { index: number; reason: string }[] = [];
  ops.forEach((op, index) => {
    const r = step(draft, op, typeof by === "string" ? by : by[index] ?? "anon", at);
    if (typeof r === "string") conflicts.push({ index, reason: r });
    else applied.push(r);
  });
  if (conflicts.length) return { ok: false, conflicts };
  Object.assign(doc, draft);
  return { ok: true, applied };
}

function step(doc: Doc, op: Op, by: string, at: number): Applied | string {
  const rev = doc.rev + 1;
  if (op.kind === "insert") {
    const i = op.after === null ? 0 : doc.lines.findIndex((l) => l.id === op.after) + 1;
    if (i === 0 && op.after !== null) return `no line ${op.after}`;
    const id = `L${doc.nextId++}`;
    doc.lines.splice(i, 0, { id, text: op.text, by, rev });
    doc.rev = rev;
    return { rev, by, at, op, line: id };
  }
  const i = doc.lines.findIndex((l) => l.id === op.line);
  if (i < 0) return `no line ${op.line}`;
  if (doc.lines[i]!.rev !== op.base) return `line ${op.line} is at rev ${doc.lines[i]!.rev}, not ${op.base}`;
  if (op.kind === "set") doc.lines[i] = { id: op.line, text: op.text, by, rev };
  else doc.lines.splice(i, 1);
  doc.rev = rev;
  return { rev, by, at, op, line: op.line };
}

/** Rebuild the file as it was at `rev` by replaying the log (onto `from`, a branch's fork point). Time travel, line by line. */
export function replay(log: Applied[], rev = Infinity, from: Doc = empty()): Doc {
  const doc = structuredClone(from);
  for (const a of log) {
    if (a.rev > rev) break;
    // Replays are trusted: force the logged id and rev so blame matches history.
    const op = a.op;
    if (op.kind === "insert") {
      const i = op.after === null ? 0 : doc.lines.findIndex((l) => l.id === op.after) + 1;
      doc.lines.splice(i, 0, { id: a.line, text: op.text, by: a.by, rev: a.rev });
      doc.nextId = Math.max(doc.nextId, Number(a.line.slice(1)) + 1);
    } else {
      const i = doc.lines.findIndex((l) => l.id === a.line);
      if (op.kind === "set") doc.lines[i] = { id: a.line, text: op.text, by: a.by, rev: a.rev };
      else doc.lines.splice(i, 1);
    }
    doc.rev = a.rev;
  }
  return doc;
}

export interface Conflict { line: string; base: string; main: string | null; branch: string | null }

/**
 * A three-way merge by line id: what `branch` changed since it forked from
 * `base`, as one batch of ops against `main` as it is now. A line only one
 * side changed merges cleanly; the same change on both sides is no change.
 * A line both sides changed merges word by word when the edits don't touch
 * the same words (one re-indents, the other changes an argument). A moved
 * line (deleted and the same text inserted elsewhere) keeps the other side's
 * edit. The same new line added at the same spot on both sides lands once.
 * Anything left (both rewrote the same words, or one changed a line the
 * other deleted) is a conflict: `resolve` settles it by line id, keeping the
 * branch's or main's version, and an unsettled one is left out and reported.
 * Other new lines never conflict: each goes after the nearest line before it
 * that main still has. Inserts are given the ids main will assign them, so
 * the batch must land on `main` exactly as passed. Deleted lines leave no
 * blame, so their ops are credited to `deleter`.
 */
export function merge(base: Doc, branch: Doc, main: Doc, resolve: Record<string, "branch" | "main"> = {}, deleter = "anon") {
  const was = new Map(base.lines.map((l) => [l.id, l])), now = new Map(main.lines.map((l) => [l.id, l]));
  const at = new Map(main.lines.map((l, i) => [l.id, i]));
  const movedOnMain = moves(base, main, was), movedOnBranch = moves(base, branch, was);
  const moveOf = new Map([...movedOnBranch].map(([id, l]) => [l.id, id]));
  const ops: Op[] = [], by: string[] = [], conflicts: Conflict[] = [], taken = new Set<string>();
  let next = main.nextId, after: string | null = null;
  const push = (op: Op, who: string) => { ops.push(op); by.push(who); };
  const insert = (t: string, who: string) => { push({ kind: "insert", after, text: t }, who); after = `L${next++}`; };
  // A line main also added right here, among its new lines after the anchor.
  const twin = (t: string) => {
    for (let i = after === null ? 0 : (at.get(after) ?? Infinity) + 1; i < main.lines.length && !was.has(main.lines[i]!.id); i++) {
      const m = main.lines[i]!;
      if (m.text === t && !taken.has(m.id)) { taken.add(m.id); return m.id; }
    }
    return null;
  };
  for (const l of branch.lines) {
    const b = was.get(l.id);
    if (!b) {
      const from = moveOf.get(l.id), m = from && now.get(from);
      // The branch moved a line: it carries main's edit, and a line both moved stays where main put it.
      if (from && !m && movedOnMain.has(from)) continue;
      if (m && m.text !== was.get(from)!.text) { insert(m.text, m.by); continue; }
      const same = twin(l.text);
      if (same) after = same;
      else insert(l.text, l.by);
      continue;
    }
    const moved = !now.has(l.id) && movedOnMain.get(l.id);
    const m = now.get(l.id) ?? (moved || undefined);
    if (l.text !== b.text && m?.text !== l.text) {
      const pick = m?.text === b.text ? "branch" : resolve[l.id];
      const words = m && !pick ? mergeWords(b.text, m.text, l.text) : null;
      if (words !== null) push({ kind: "set", line: m!.id, base: m!.rev, text: words }, l.by);
      else if (!pick) conflicts.push({ line: l.id, base: b.text, main: m?.text ?? null, branch: l.text });
      else if (pick === "branch") {
        if (!m) { insert(l.text, l.by); continue; }
        push({ kind: "set", line: m.id, base: m.rev, text: l.text }, l.by);
      }
    }
    if (m && !moved) after = m.id;
  }
  const kept = new Set(branch.lines.map((l) => l.id));
  for (const b of base.lines) {
    if (kept.has(b.id)) continue;
    // Moved on both sides: main's copy stays.
    const m = now.get(b.id) ?? (movedOnBranch.has(b.id) ? undefined : movedOnMain.get(b.id));
    if (!m) continue;
    const pick = m.text === b.text || movedOnBranch.has(b.id) ? "branch" : resolve[b.id];
    if (!pick) conflicts.push({ line: b.id, base: b.text, main: m.text, branch: null });
    else if (pick === "branch") push({ kind: "delete", line: m.id, base: m.rev }, deleter);
  }
  return { ops, by, conflicts };
}

/**
 * Lines `side` moved since `base`: each base line it deleted whose exact text
 * it inserted elsewhere, by base id. Only an unambiguous text counts (one
 * deleted, one added), and never a blank line.
 */
function moves(base: Doc, side: Doc, was: Map<string, Line>) {
  const has = new Set(side.lines.map((l) => l.id));
  const gone = new Map<string, string[]>(), added = new Map<string, Line[]>();
  for (const l of base.lines) if (!has.has(l.id) && l.text.trim()) gone.set(l.text, [...gone.get(l.text) ?? [], l.id]);
  for (const l of side.lines) if (!was.has(l.id) && l.text.trim()) added.set(l.text, [...added.get(l.text) ?? [], l]);
  const out = new Map<string, Line>();
  for (const [t, ids] of gone) {
    const to = added.get(t);
    if (ids.length === 1 && to?.length === 1) out.set(ids[0]!, to[0]!);
  }
  return out;
}

const words = (s: string) => s.match(/\s+|\w+|[^\s\w]/g) ?? [];

/**
 * Two edits of one line, merged word by word: each side's changes to `base`
 * as spans of words, applied together. Null when the spans overlap or touch
 * (unless both made the very same change), which is a real conflict.
 */
export function mergeWords(base: string, a: string, b: string): string | null {
  const o = words(base);
  const spans = (x: string[]) => {
    const out: { from: number; to: number; text: string }[] = [];
    let i = -1, j = -1;
    for (const p of [...keptPairs(o, x), { i: o.length, j: x.length }]) {
      if (p.i > i + 1 || p.j > j + 1) out.push({ from: i + 1, to: p.i, text: x.slice(j + 1, p.j).join("") });
      i = p.i;
      j = p.j;
    }
    return out;
  };
  const all = [...spans(words(a)), ...spans(words(b))].sort((p, q) => p.from - q.from || p.to - q.to);
  let out = "", i = 0, last: (typeof all)[number] | null = null;
  for (const s of all) {
    if (last && s.from <= last.to) {
      if (s.from === last.from && s.to === last.to && s.text === last.text) continue;
      return null;
    }
    out += o.slice(i, s.from).join("") + s.text;
    i = s.to;
    last = s;
  }
  return out + o.slice(i).join("");
}

export const text = (doc: Doc) => doc.lines.map((l) => l.text).join("\n");

/** Ops that create a file from plain text. */
export function fromText(content: string): Op[] {
  // Each insert goes after the previous one; ids are assigned in order, so we
  // can predict them from nextId on an empty doc.
  return content.split("\n").map((t, i) => ({ kind: "insert", after: i === 0 ? null : `L${i}`, text: t }));
}

export async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
