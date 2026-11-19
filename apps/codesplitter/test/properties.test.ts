import { expect, test } from "bun:test";
import fc from "fast-check";
import { apply, empty, fromText, merge, parseOps, replay, text, type Applied, type Doc, type Op } from "../src/lines.ts";
import { hunks } from "../src/patch.ts";

// Property tests (#5333): one rule that holds for every input, tried on a few hundred random ones, in place of a
// page of hand-picked examples. When one fails, fast-check prints the smallest input that breaks it and a seed:
// `fc.assert(..., { seed })` runs that case again.

/** One line of a file: anything but a line break. */
const line = fc.string({ maxLength: 24 }).filter((s) => !/[\n\r]/.test(s));
const lines = fc.array(line, { minLength: 1, maxLength: 30 });

/** A file holding `ls`, written by `by`, and the log that made it. */
function file(ls: string[], by = "ana"): { doc: Doc; log: Applied[] } {
  const doc = empty(), r = apply(doc, fromText(ls.join("\n")), by, 1);
  if (!r.ok) throw new Error("a new file's ops were refused");
  return { doc, log: r.applied };
}

/** An edit to pick against whatever the file holds then: `at` chooses the line, by its place. */
const edit = fc.record({ kind: fc.constantFrom("insert", "set", "delete"), at: fc.nat(), text: line });
type Edit = { kind: string; at: number; text: string };

/** `e` as an op on `doc` as it stands, or null when there is no line to act on. */
function opFor(doc: Doc, e: Edit): Op | null {
  const l = doc.lines[e.at % (doc.lines.length || 1)];
  if (e.kind === "insert") return { kind: "insert", after: e.at % 3 === 0 || !l ? null : l.id, text: e.text };
  if (!l) return null;
  return e.kind === "set" ? { kind: "set", line: l.id, text: e.text, base: l.rev } : { kind: "delete", line: l.id, base: l.rev };
}

/** Applies each edit in turn as `by`, and answers the log of what landed. */
function work(doc: Doc, edits: Edit[], by: string): Applied[] {
  const log: Applied[] = [];
  for (const e of edits) {
    const op = opFor(doc, e);
    if (!op) continue;
    const r = apply(doc, [op], by, 2);
    if (!r.ok) throw new Error(`an edit on the line as it stands was refused: ${r.conflicts[0]?.reason}`);
    log.push(...r.applied);
  }
  return log;
}

/** A copy of `doc` to edit as a branch (or as main moving on). */
const fork = (doc: Doc): Doc => structuredClone(doc);

test("text split into lines and joined again is the text", () => {
  fc.assert(fc.property(lines, (ls) => { expect(text(file(ls).doc)).toBe(ls.join("\n")); }));
});

test("what fromText writes, parseOps takes back unchanged", () => {
  fc.assert(fc.property(lines, (ls) => { const ops = fromText(ls.join("\n")); expect(parseOps(JSON.parse(JSON.stringify(ops)))).toEqual(ops); }));
});

test("replaying a file's log rebuilds the file, at every rev along the way", () => {
  fc.assert(fc.property(lines, fc.array(edit, { maxLength: 25 }), fc.nat(), (ls, edits, stop) => {
    const { doc, log } = file(ls), mid = fork(doc);
    const cut = stop % (edits.length + 1);
    log.push(...work(mid, edits.slice(0, cut), "bo"));
    const then = fork(mid);
    Object.assign(doc, fork(mid));
    log.push(...work(doc, edits.slice(cut), "bo"));
    expect(replay(log)).toEqual(doc);
    expect(replay(log, then.rev)).toEqual(then);
  }));
});

test("a branch that changed nothing merges as nothing, whatever main did", () => {
  fc.assert(fc.property(lines, fc.array(edit, { maxLength: 15 }), (ls, edits) => {
    const base = file(ls).doc, main = fork(base);
    work(main, edits, "bo");
    const m = merge(base, fork(base), main);
    expect(m.conflicts).toEqual([]);
    expect(m.ops).toEqual([]);
  }));
});

test("a branch merged into a main that stood still leaves main reading as the branch", () => {
  fc.assert(fc.property(lines, fc.array(edit, { maxLength: 15 }), (ls, edits) => {
    const base = file(ls).doc, branch = fork(base), main = fork(base);
    work(branch, edits, "cy");
    const m = merge(base, branch, main, {}, "cy", "notes.txt");
    expect(m.conflicts).toEqual([]);
    expect(apply(main, m.ops, m.by, 3).ok).toBe(true);
    expect(text(main)).toBe(text(branch));
  }));
});

test("changes to different lines merge without a question, and both sides' lines are kept", () => {
  const change = fc.record({ at: fc.nat(), text: line });
  fc.assert(fc.property(fc.array(line, { minLength: 2, maxLength: 30 }), fc.array(change, { maxLength: 8 }), fc.array(change, { maxLength: 8 }), (ls, ours, theirs) => {
    const base = file(ls).doc, branch = fork(base), main = fork(base);
    // The branch takes the even lines and main the odd ones, so no line is changed twice.
    const set = (doc: Doc, c: { at: number; text: string }, odd: number, by: string) => {
      const l = doc.lines[(c.at % Math.ceil((ls.length - odd) / 2)) * 2 + odd]!;
      expect(apply(doc, [{ kind: "set", line: l.id, text: c.text, base: l.rev }], by, 2).ok).toBe(true);
    };
    for (const c of ours) set(branch, c, 0, "cy");
    for (const c of theirs) set(main, c, 1, "bo");
    const m = merge(base, branch, main, {}, "cy", "notes.txt");
    expect(m.conflicts).toEqual([]);
    expect(apply(main, m.ops, m.by, 3).ok).toBe(true);
    expect(main.lines.map((l) => l.text)).toEqual(ls.map((_, i) => (i % 2 ? main : branch).lines[i]!.text));
  }));
});

test("one line both sides rewrote is asked about, and the pick decides it", () => {
  fc.assert(fc.property(lines, fc.nat(), fc.constantFrom("main" as const, "branch" as const), (ls, at, pick) => {
    const base = file(ls).doc, branch = fork(base), main = fork(base), i = at % ls.length, id = base.lines[i]!.id;
    const said = { main: `main says ${i}`, branch: `the branch said ${i} instead` };
    apply(branch, [{ kind: "set", line: id, text: said.branch, base: base.lines[i]!.rev }], "cy", 2);
    apply(main, [{ kind: "set", line: id, text: said.main, base: base.lines[i]!.rev }], "bo", 2);
    const asked = merge(base, branch, main, {}, "cy", "a.ts", "cy", "code", false);
    expect(asked.conflicts.map((c) => c.line)).toEqual([id]);
    const m = merge(base, branch, main, { [id]: pick }, "cy", "a.ts", "cy", "code", false);
    expect(m.conflicts).toEqual([]);
    expect(apply(main, m.ops, m.by, 3).ok).toBe(true);
    expect(main.lines[i]!.text).toBe(said[pick]);
  }));
});

/** `before` with the diff's hunks applied, as `git apply` would: every header's counts must match its body. */
function applyHunks(before: string, diff: string): string {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n"), out: string[] = [];
  let i = 0, endsWithBreak = before.endsWith("\n") || before === "";
  const body = diff.split("\n");
  for (let k = 0; k < body.length; k++) {
    const head = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(body[k]!);
    if (!head) continue;
    const from = Number(head[1]), took = Number(head[2] ?? 1), gave = Number(head[4] ?? 1);
    const start = took ? from - 1 : from;
    while (i < start) out.push(a[i++]!);
    let minus = 0, plus = 0;
    for (k++; k < body.length && !body[k]!.startsWith("@@"); k++) {
      const l = body[k]!, sign = l[0];
      if (sign === "\\") { if (body[k - 1]![0] !== "-") endsWithBreak = false; continue; }
      if (sign === undefined) continue;
      if (sign !== "+") { expect(a[i]).toBe(l.slice(1)); i++; minus++; }
      if (sign !== "-") { out.push(l.slice(1)); plus++; if (sign === "+" || i === a.length) endsWithBreak = true; }
    }
    k--;
    expect([minus, plus]).toEqual([took, gave]);
  }
  while (i < a.length) out.push(a[i++]!);
  return out.length ? out.join("\n") + (endsWithBreak ? "\n" : "") : "";
}

test("a diff's hunks, applied to the old text, give the new text", () => {
  // Few distinct lines, so the two texts share runs and the hunks have context to get wrong.
  const few = fc.array(fc.constantFrom("a", "b", "c", "}", ""), { maxLength: 14 }).map((ls) => ls.map((l) => `${l}\n`).join(""));
  fc.assert(fc.property(few, few, (before, after) => { expect(applyHunks(before, hunks(before, after))).toBe(after); }));
});
