// A file is an ordered list of lines with stable ids, plus an append-only log
// of ops against those ids. Pure functions: the Durable Object owns the state,
// the tests and the agents demo drive these directly.
//
// Ops name lines by id, never by index, so two agents editing different lines
// never collide. Editing the same line is optimistic: `set` and `delete` carry
// the line's `base` rev, and a stale base is a conflict the caller retries.

export interface Line { id: string; text: string; by: string; rev: number }

export type Op =
  | { kind: "insert"; after: string | null; text: string }
  | { kind: "set"; line: string; text: string; base: number }
  | { kind: "delete"; line: string; base: number };

export interface Applied { rev: number; by: string; at: number; op: Op; line: string }

export interface Doc { rev: number; nextId: number; lines: Line[] }

export type Result = { ok: true; applied: Applied[] } | { ok: false; conflicts: { index: number; reason: string }[] };

export const empty = (): Doc => ({ rev: 0, nextId: 1, lines: [] });

/** Apply a batch all-or-nothing. On success `doc` is mutated; on conflict it is untouched. */
export function apply(doc: Doc, ops: Op[], by: string, at = Date.now()): Result {
  const draft: Doc = { rev: doc.rev, nextId: doc.nextId, lines: doc.lines.map((l) => ({ ...l })) };
  const applied: Applied[] = [];
  const conflicts: { index: number; reason: string }[] = [];
  ops.forEach((op, index) => {
    const r = step(draft, op, by, at);
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

/** Rebuild the file as it was at `rev` by replaying the log. Time travel, line by line. */
export function replay(log: Applied[], rev = Infinity): Doc {
  const doc = empty();
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
