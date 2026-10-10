// A file is an ordered list of lines with stable ids, plus an append-only log
// of ops against those ids. Pure functions: the Durable Object owns the state,
// the tests and the agents demo drive these directly.
//
// Ops name lines by id, never by index, so two agents editing different lines
// never collide. Editing the same line is optimistic: `set` and `delete` carry
// the line's `base` rev, and a stale base is a conflict the caller retries.
// An edit that depends on other lines too (a rename, "is this ever
// reassigned?") passes `ifRev`: the whole file must still be at that rev.

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
 * A line both sides changed (or one changed and the other deleted) is a
 * conflict: `resolve` settles it by line id, keeping the branch's or main's
 * version, and an unsettled one is left out and reported. New lines never
 * conflict: each goes after the nearest line before it that main still has.
 * Inserts are given the ids main will assign them, so the batch must land
 * on `main` exactly as passed. Deleted lines leave no blame, so their ops are
 * credited to `deleter`.
 */
export function merge(base: Doc, branch: Doc, main: Doc, resolve: Record<string, "branch" | "main"> = {}, deleter = "anon") {
  const was = new Map(base.lines.map((l) => [l.id, l])), now = new Map(main.lines.map((l) => [l.id, l]));
  const ops: Op[] = [], by: string[] = [], conflicts: Conflict[] = [];
  let next = main.nextId, after: string | null = null;
  const push = (op: Op, who: string) => { ops.push(op); by.push(who); };
  const insert = (t: string, who: string) => { push({ kind: "insert", after, text: t }, who); after = `L${next++}`; };
  for (const l of branch.lines) {
    const b = was.get(l.id), m = now.get(l.id);
    if (!b) { insert(l.text, l.by); continue; }
    if (l.text !== b.text && m?.text !== l.text) {
      const pick = m?.text === b.text ? "branch" : resolve[l.id];
      if (!pick) conflicts.push({ line: l.id, base: b.text, main: m?.text ?? null, branch: l.text });
      else if (pick === "branch") {
        if (!m) { insert(l.text, l.by); continue; }
        push({ kind: "set", line: m.id, base: m.rev, text: l.text }, l.by);
      }
    }
    if (m) after = m.id;
  }
  const kept = new Set(branch.lines.map((l) => l.id));
  for (const b of base.lines) {
    const m = now.get(b.id);
    if (kept.has(b.id) || !m) continue;
    const pick = m.text === b.text ? "branch" : resolve[b.id];
    if (!pick) conflicts.push({ line: b.id, base: b.text, main: m.text, branch: null });
    else if (pick === "branch") push({ kind: "delete", line: m.id, base: m.rev }, deleter);
  }
  return { ops, by, conflicts };
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
