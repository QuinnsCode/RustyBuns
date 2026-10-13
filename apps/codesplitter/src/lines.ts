// Layout: the line model: ops, conflicts, replay. Pure functions
// A file is an ordered list of lines with stable ids, plus an append-only log
// of ops against those ids. Pure functions: the Durable Object owns the state,
// the tests and the agents demo drive these directly.
//
// Ops name lines by id, never by index, so two agents editing different lines
// never collide. Editing the same line is optimistic: `set` and `delete` carry
// the line's `base` rev, and a stale base is a conflict the caller retries (unless
// the file DO can rebase it word by word: file-do.ts `rebase`).
// An edit that depends on other lines too (a rename, "is this ever
// reassigned?") passes `ifRev`: the whole file must still be at that rev.

import { parse as parseToml } from "smol-toml";
import type { Rule } from "./policy.ts";
import { parseAllDocuments } from "yaml";
import { alike, keptPairs } from "./sync.ts";

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
  const near = { i: 0 };
  ops.forEach((op, index) => {
    const r = step(draft, op, typeof by === "string" ? by : by[index] ?? "anon", at, near);
    if (typeof r === "string") conflicts.push({ index, reason: r });
    else applied.push(r);
  });
  if (conflicts.length) return { ok: false, conflicts };
  Object.assign(doc, draft);
  return { ok: true, applied };
}

/**
 * Where line `id` is, scanning outward from `near.i` (the last line the batch
 * touched): a paste inserts each line after the one before, and a diff or block
 * delete walks the file in order, so a big batch stays linear, not quadratic.
 */
function locate(lines: Line[], id: string, near: { i: number }): number {
  const from = Math.min(Math.max(near.i, 0), lines.length);
  for (let d = 0; from + d < lines.length || from - d >= 0; d++) {
    if (lines[from + d]?.id === id) return from + d;
    if (d && lines[from - d]?.id === id) return from - d;
  }
  return -1;
}

function step(doc: Doc, op: Op, by: string, at: number, near: { i: number }): Applied | string {
  const rev = doc.rev + 1;
  if (op.kind === "insert") {
    const i = op.after === null ? 0 : locate(doc.lines, op.after, near) + 1;
    if (i === 0 && op.after !== null) return `no line ${op.after}`;
    const id = `L${doc.nextId++}`;
    doc.lines.splice(i, 0, { id, text: op.text, by, rev });
    near.i = i;
    doc.rev = rev;
    return { rev, by, at, op, line: id };
  }
  const i = locate(doc.lines, op.line, near);
  if (i < 0) return `no line ${op.line}`;
  near.i = i;
  if (doc.lines[i]!.rev !== op.base) return `line ${op.line} is at rev ${doc.lines[i]!.rev}, not ${op.base}`;
  if (op.kind === "set") doc.lines[i] = { id: op.line, text: op.text, by, rev };
  else doc.lines.splice(i, 1);
  doc.rev = rev;
  return { rev, by, at, op, line: op.line };
}

/** Rebuild the file as it was at `rev` by replaying the log (onto `from`, a branch's fork point). Time travel, line by line. */
export function replay(log: Applied[], rev = Infinity, from: Doc = empty()): Doc {
  const doc = structuredClone(from);
  const near = { i: 0 };
  for (const a of log) {
    if (a.rev > rev) break;
    // Replays are trusted: force the logged id and rev so blame matches history.
    const op = a.op;
    if (op.kind === "insert") {
      const i = op.after === null ? 0 : locate(doc.lines, op.after, near) + 1;
      doc.lines.splice(i, 0, { id: a.line, text: op.text, by: a.by, rev: a.rev });
      near.i = i;
      doc.nextId = Math.max(doc.nextId, Number(a.line.slice(1)) + 1);
    } else {
      const i = locate(doc.lines, a.line, near);
      near.i = i;
      if (op.kind === "set") doc.lines[i] = { id: a.line, text: op.text, by: a.by, rev: a.rev };
      else doc.lines.splice(i, 1);
    }
    doc.rev = a.rev;
  }
  return doc;
}

/**
 * A conflict, keyed by `line`: a base line (the first of a stretch both sides
 * rewrote), a new branch line main also added (`doubled`), `key:<path>` for a
 * config key the merge would define twice, or `file` for a lockfile both
 * changed (`whole`: keep one side, then regenerate it), or `lint:<problem>`
 * for merged code that would no longer build (`lint`, from lint.ts).
 */
export interface Conflict { line: string; base: string; main: string | null; branch: string | null; doubled?: true; whole?: true; lint?: string }

/**
 * How one conflict is settled: keep main's, keep the branch's, keep both (main's
 * first, or the branch's first), or a text of your own, which may be several
 * lines. A lockfile, a doubled config key or code that won't build only takes
 * main or branch: the others leave it a conflict.
 */
export type Pick = "main" | "branch" | "both" | "both:branch-first" | { text: string };
export type Resolve = Record<string, Pick>;
export const PICKS = ["main", "branch", "both", "both:branch-first"] as const;
const sideOnly = (id: string) => id === "file" || id.startsWith("key:") || id.startsWith("lint:");

/** How a file merges, by its path: lockfiles whole, config by key, prose loosely, code strictly. */
export type Kind = "lock" | "keyed" | "prose" | "code";
export function kindOf(path: string): Kind {
  if (/(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|go\.sum)$/.test(path)) return "lock";
  if (/(^|\/)\.env|\.env$|\.(json|jsonc|ya?ml|toml)$/i.test(path)) return "keyed";
  if (/\.(md|mdx|markdown|txt|rst|adoc)$/i.test(path)) return "prose";
  return "code";
}

/**
 * A three-way merge by line id: what `branch` changed since it forked from
 * `base`, as one batch of ops against `main` as it is now. A line only one
 * side changed merges cleanly; the same change on both sides is no change.
 * A line both sides changed merges word by word when the edits don't touch
 * the same words (one re-indents, the other changes an argument), and items
 * both added to one list at one spot both land, main's first (see mergeWords).
 * A moved line or block (deleted and the same text inserted elsewhere) keeps
 * the other side's edit, and lines the branch added under a line main moved
 * go under it where it is now. New lines both added at one spot land main's
 * first, or in order in a sorted block (an import block, keys one per line);
 * the same new line added at the same spot on both sides lands once.
 * A stretch both sides reshaped settles line by line where it can (see blend),
 * or word by word when it's a statement one side joined or wrapped (see rejoin).
 * A name one side renamed across the file (see renames) is renamed in the
 * lines the other side added too.
 *
 * Conflicts, each settled by `resolve` (by its `line`: main's, the branch's,
 * both, or a text of `writer`'s; see Pick) or left out and reported:
 * - a stretch both sides reshaped that won't settle line by line: lines added
 *   or deleted on one side where the other changed a line too (one changed a
 *   line the other deleted, or both rewrote a function). The whole stretch is
 *   one conflict, as in git.
 * - one line both rewrote in the same words.
 * - the same line added on both sides in different places in one block
 *   (`doubled`): it would land twice.
 * - by `rule`, the path's merge rule (`kindOf`, or the repo's policy.ts
 *   override; `union` keeps both sides of what they both rewrote): a lockfile both changed is one whole-file
 *   conflict, since a line merge of one is never valid; a config key (.env,
 *   JSON, YAML, TOML) the merge would define twice is a conflict; and in code,
 *   lines added right next to lines the other side deleted are a conflict too
 *   (the deleted lines may be what the new ones use). Prose is left loose.
 * - a merge that would bring git's conflict markers into main, or leave a
 *   JSON file that won't parse (see broken).
 *
 * A generated region both sides changed keeps main's copy and names the
 * command that rebuilds it in `regenerate` (see generated).
 *
 * Other new lines never conflict: each goes after the nearest line before it
 * that main still has. Inserts are given the ids main will assign them, so
 * the batch must land on `main` exactly as passed. Deleted lines leave no
 * blame, so their ops are credited to `deleter`.
 */
export function merge(base: Doc, branch: Doc, main: Doc, given: Resolve = {}, deleter = "anon", path = "", writer = deleter, rule: Rule = kindOf(path)): { ops: Op[]; by: string[]; conflicts: Conflict[]; regenerate?: string[] } {
  const g = generated(base, branch, main);
  const m = mergeLines(base, g.branch, main, given, deleter, path, writer, rule);
  return g.regenerate.length ? { ...m, regenerate: g.regenerate } : m;
}

/** A generated region opens with `<!-- generated: <command> -->` (or `// generated:`, `# generated:`) on a line of its own. */
const GENERATED = /^\s*(?:<!--|\/\/|#)\s*generated:\s*(.+?)\s*(?:-->)?\s*$/;
/** And closes with `<!-- /generated -->`, or runs to the end of the file. */
const GENERATED_END = /^\s*(?:<!--|\/\/|#)\s*\/generated\s*(?:-->)?\s*$/;

/** The generated regions of `lines`: the opening marker's index, the closing one's (or the length), and the command that rebuilds it. */
export function generatedRegions(lines: string[]): { from: number; to: number; command: string }[] {
  const out: { from: number; to: number; command: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(GENERATED);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !GENERATED_END.test(lines[j]!)) j++;
    out.push({ from: i, to: j, command: m[1]! });
    i = j;
  }
  return out;
}

/**
 * Generated text both sides touched (#1154): a table a script builds, like REFERENCE.md's Layout. A line
 * merge of one is stale even when it settles, so the branch's edits inside it are dropped (main's copy
 * stays, never a card) and its command is returned, to run on the merged tree. A region either side
 * opened, closed or lost a marker of merges as ordinary lines.
 */
function generated(base: Doc, branch: Doc, main: Doc): { branch: Doc; regenerate: string[] } {
  const regenerate: string[] = [];
  let lines = branch.lines;
  for (const r of generatedRegions(base.lines.map((l) => l.text))) {
    const open = base.lines[r.from]!.id, close = base.lines[r.to]?.id;
    const inside = (ls: Line[]) => {
      const i = ls.findIndex((l) => l.id === open), j = close ? ls.findIndex((l) => l.id === close) : ls.length;
      return i < 0 || j < 0 || j < i || ls[i]!.text !== base.lines[r.from]!.text ? null : { i, j, text: ls.slice(i + 1, j).map((l) => l.text).join("\n") };
    };
    const was = base.lines.slice(r.from + 1, r.to).map((l) => l.text).join("\n"), m = inside(main.lines), b = inside(lines);
    if (!m || !b || m.text === was || b.text === was) continue;
    lines = [...lines.slice(0, b.i + 1), ...base.lines.slice(r.from + 1, r.to), ...lines.slice(b.j)];
    if (!regenerate.includes(r.command)) regenerate.push(r.command);
  }
  return { branch: lines === branch.lines ? branch : { ...branch, lines }, regenerate };
}

function mergeLines(base: Doc, branch: Doc, main: Doc, given: Resolve, deleter: string, path: string, writer: string, rule: Rule): { ops: Op[]; by: string[]; conflicts: Conflict[] } {
  if (rule === "union") {
    // git's merge=union: what both rewrote keeps both, main's first; a line both added lands once. Markers and broken data still refuse.
    const first = mergeLines(base, branch, main, given, deleter, path, writer, "prose");
    const keep = (c: Conflict): Pick => {
      if (c.doubled) return "main";
      const m = c.main?.split("\n") ?? [], b = c.branch?.split("\n") ?? [], fresh = b.filter((l) => !m.includes(l));
      return fresh.length === b.length ? "both" : { text: [...m, ...fresh].join("\n") };
    };
    const both: Resolve = Object.fromEntries(first.conflicts.filter((c) => !sideOnly(c.line)).map((c) => [c.line, keep(c)]));
    return mergeLines(base, branch, main, { ...both, ...given }, deleter, path, writer, "prose");
  }
  // What only takes a side keeps only a side.
  const resolve: Resolve = Object.fromEntries(Object.entries(given).filter(([id, v]) => !sideOnly(id) || v === "main" || v === "branch"));
  const kind = rule;
  if (kind === "lock") {
    const [b, m, br] = [base, main, branch].map(text);
    if (b !== m && b !== br && m !== br) return wholeFile(branch, main, resolve.file as "main" | "branch" | undefined, deleter);
  }
  const was = new Map(base.lines.map((l) => [l.id, l]));
  // A diff pairs lines by likeness, so a line it rewrote may really have moved (see rewrites).
  // Each such line gets an id of its own here; main's go back on the ops at the end.
  main = unpair(main, rewrites(base, main, was));
  branch = unpair(branch, rewrites(base, branch, was));
  const now = new Map(main.lines.map((l) => [l.id, l]));
  const at = new Map(main.lines.map((l, i) => [l.id, i]));
  const movedOnMain = moves(base, main, was), movedOnBranch = moves(base, branch, was);
  const loose = (t: string) => kind === "prose" || remark(t);
  // A name main renamed across the file is renamed in the lines the branch added too, and the other way round (#1156).
  const mainRenames = renames(base, main, loose, movedOnMain), branchRenames = renames(base, branch, loose, movedOnBranch);
  if (mainRenames.length) {
    const into = new Set([...movedOnBranch.values()].map((l) => l.id)), scoped = scopes(branch.lines);
    branch = { ...branch, lines: branch.lines.map((l) => was.has(l.id) || into.has(l.id) ? l : { ...l, text: carry(l.text, mainRenames, loose(l.text), scoped.get(l.id)) }) };
  }
  const moveOf = new Map([...movedOnBranch].map(([id, l]) => [l.id, id]));
  const mainPos = places(base, main), branchPos = places(base, branch);
  const regions = joined(clashes(hunks(base, main, mainPos, movedOnMain), hunks(base, branch, branchPos, movedOnBranch), kind !== "prose"), base, [main, mainPos, movedOnMain], [branch, branchPos, movedOnBranch]);
  const inRegion = (p: number) => regions.some((g) => covers(g, p));
  // Lines main added that weren't in the file already, and the block each went in: a line that already repeats (a test's setup call) is no sign of doubling.
  const before = new Set(base.lines.map((l) => l.text)), mainHeads = heads(main.lines), branchHeads = heads(branch.lines);
  const mainAdded = new Map<string, Set<string>>();
  main.lines.forEach((l, i) => { if (!was.has(l.id) && !before.has(l.text)) mainAdded.set(l.text, (mainAdded.get(l.text) ?? new Set()).add(mainHeads[i]!)); });
  const ops: Op[] = [], by: string[] = [], conflicts: Conflict[] = [], taken = new Set<string>();
  let next = main.nextId, after: string | null = null;
  const dropped = new Set<string>(), replaced = new Map<string, string | null>(), push = (op: Op, who: string) => { ops.push(op); by.push(who); if (op.kind === "delete") dropped.add(op.line); };
  const insert = (t: string, who: string) => { push({ kind: "insert", after, text: t }, who); after = `L${next++}`; };
  // A line main also added right here, among its new lines after the anchor.
  const twin = (t: string) => {
    for (let i = after === null ? 0 : (at.get(after) ?? Infinity) + 1; i < main.lines.length && !was.has(main.lines[i]!.id); i++) {
      const m = main.lines[i]!;
      if (m.text === t && !taken.has(m.id)) { taken.add(m.id); return m.id; }
    }
    return null;
  };
  // Main's new lines right at this spot go first (it landed first). A line both added was a twin already.
  const movedIn = new Set([...movedOnMain.values()].map((l) => l.id)), fresh = (m: Line) => !was.has(m.id) && !movedIn.has(m.id) && !taken.has(m.id);
  // In a sorted block (see runs), main's new lines go first only while they sort before the branch's `t`;
  // `resume` is where main's new lines carry on after a branch line that went in among them.
  const run = runs(base.lines), atBase = new Map(base.lines.map((l, i) => [l.id, i]));
  let resume: { id: string; i: number } | null = null;
  const sortedAt = (i: number, t: string) => {
    let p = i - 1, n = i;
    while (p >= 0 && !atBase.has(main.lines[p]!.id)) p--;
    while (n < main.lines.length && !atBase.has(main.lines[n]!.id)) n++;
    const rp = p >= 0 ? run[atBase.get(main.lines[p]!.id)!] : undefined, rn = n < main.lines.length ? run[atBase.get(main.lines[n]!.id)!] : undefined;
    const r = rp ?? rn;
    return !!r && (!rp || !rn || rp === rn) && r.indent === indent(t);
  };
  const behindMain = (t: string) => {
    let i = after === null ? 0 : after === resume?.id ? resume.i : (at.get(after) ?? Infinity) + 1;
    const inOrder = i < main.lines.length && fresh(main.lines[i]!) && sortedAt(i, t);
    for (; i < main.lines.length && fresh(main.lines[i]!); i++) {
      const m = main.lines[i]!.text;
      if (inOrder && indent(m) === indent(t) && sortKey(m) > sortKey(t)) return i;
      after = main.lines[i]!.id;
    }
    return null;
  };
  const written = (pick: Pick | undefined) => typeof pick === "object" ? pick.text.split("\n") : null;
  // A stretch both reshaped: keep main's as is, swap in the branch's whole or a text of the writer's, or keep both.
  const settle = (g: Region) => {
    const within = (d: Doc, pos: Map<string, number>) => d.lines.filter((l) => covers(g, pos.get(l.id)!));
    const ms = within(main, mainPos), bs = within(branch, branchPos), key = base.lines[Math.ceil((g.lo - 1) / 2)]!.id;
    const join = (ls: Line[]) => ls.length ? ls.map((l) => l.text).join("\n") : null;
    // Both reshaped it the same way: nothing to do.
    const pick = join(ms) === join(bs) ? "main" : resolve[key], own = written(pick);
    // Just before the stretch, unless something already went in there.
    // A line an earlier stretch swapped out stands for what went in its place.
    const before = () => {
      if (after !== null && !now.has(after)) return;
      after = null;
      for (const l of main.lines.filter((l) => mainPos.get(l.id)! < g.lo).reverse()) {
        if (replaced.has(l.id)) { after = replaced.get(l.id)!; break; }
        if (!dropped.has(l.id)) { after = l.id; break; }
      }
    };
    if (pick === "branch" || own) {
      before();
      for (const m of ms) push({ kind: "delete", line: m.id, base: m.rev }, deleter);
      if (own) for (const t of own) insert(t, writer);
      else for (const l of bs) insert(l.text, l.by);
      for (const m of ms) replaced.set(m.id, after);
      return;
    }
    if (pick === "both:branch-first") {
      before();
      for (const l of bs) insert(l.text, l.by);
      if (ms.length) after = ms.at(-1)!.id;
      return;
    }
    if (pick === "both") {
      if (ms.length) after = ms.at(-1)!.id;
      else before();
      for (const l of bs) insert(l.text, l.by);
      return;
    }
    const bl = base.lines.filter((_, i) => covers(g, 2 * i + 1)), both = pick ? null : blend(bl, ms, bs, kind !== "prose", loose) ?? rejoin(bl, ms, bs, kind !== "prose", loose);
    if (both) {
      before();
      const keep = new Set(both.map((e) => e.m?.id));
      for (const m of ms) if (!keep.has(m.id)) push({ kind: "delete", line: m.id, base: m.rev }, deleter);
      for (const e of both) {
        if (!e.m) { insert(e.text, e.by); continue; }
        if (e.text !== e.m.text) push({ kind: "set", line: e.m.id, base: e.m.rev, text: e.text }, e.by);
        after = e.m.id;
      }
      return;
    }
    if (!pick) conflicts.push({ line: key, base: join(bl)!, main: join(ms), branch: join(bs) });
    if (ms.length) after = ms.at(-1)!.id;
  };
  let r = 0, shift: { from: string; to: string } | null = null;
  for (let [k, l] of branch.lines.entries()) {
    const p = branchPos.get(l.id)!;
    while (r < regions.length && regions[r]!.lo <= p) settle(regions[r++]!);
    if (r && covers(regions[r - 1]!, p)) { shift = null; continue; }
    const b = was.get(l.id);
    if (!b) {
      const from = moveOf.get(l.id), m = from && now.get(from);
      // The branch moved a line: it carries main's edit, and a line both moved stays where main put it.
      if (from && !m && movedOnMain.has(from)) continue;
      if (from) shift = null;
      if (m && m.text !== was.get(from)!.text) { insert(blendLine(was.get(from)!.text, m.text, l.text, loose(m.text)) ?? m.text, m.by); continue; }
      // Under a line main re-indented, the branch's new lines move with it.
      if (shift && l.text.startsWith(shift.from)) l = { ...l, text: shift.to + l.text.slice(shift.from.length) };
      const same = twin(l.text);
      if (same) { after = same; continue; }
      // Main added this very line somewhere else: landing it too would double it.
      // Main's copy stays; settled as the branch (or both) it lands as well, or as a text in its place.
      const twice = resolve[l.id];
      if (mainAdded.get(l.text)?.has(branchHeads[k]!) && /[A-Za-z]{2}/.test(l.text) && l.text.trim().length >= 8 && twice !== "branch" && twice !== "both" && twice !== "both:branch-first") {
        if (!twice) conflicts.push({ line: l.id, base: "", main: l.text, branch: l.text, doubled: true });
        for (const t of written(twice) ?? []) insert(t, writer);
        continue;
      }
      const stop = behindMain(l.text);
      insert(l.text, l.by);
      if (stop !== null) resume = { id: after!, i: stop };
      continue;
    }
    const moved = !now.has(l.id) && movedOnMain.get(l.id);
    const m = now.get(l.id) ?? (moved || undefined);
    shift = m && indent(m.text) !== indent(b.text) && indent(l.text) === indent(b.text) ? { from: indent(b.text), to: indent(m.text) } : null;
    if (l.text !== b.text && m?.text !== l.text) {
      const pick = m?.text === b.text ? "branch" : resolve[l.id];
      const words = m && !pick ? blendLine(b.text, m.text, l.text, loose(b.text)) : null;
      if (words !== null) push({ kind: "set", line: m!.id, base: m!.rev, text: words }, l.by);
      else if (!pick) conflicts.push({ line: l.id, base: b.text, main: m?.text ?? null, branch: l.text });
      else if (pick !== "main") {
        const own = written(pick);
        // Main deleted it: both is the branch's line back.
        if (!m) { for (const t of own ?? [l.text]) insert(t, own ? writer : l.by); continue; }
        if (own) {
          push({ kind: "set", line: m.id, base: m.rev, text: own[0]! }, writer);
          after = m.id;
          for (const t of own.slice(1)) insert(t, writer);
          continue;
        }
        if (pick === "both") { after = m.id; insert(l.text, l.by); continue; }
        // The branch's first: main's line takes the branch's text, and main's text goes in under it, still main's.
        if (pick === "both:branch-first") { push({ kind: "set", line: m.id, base: m.rev, text: l.text }, l.by); after = m.id; insert(m.text, m.by); continue; }
        push({ kind: "set", line: m.id, base: m.rev, text: l.text }, l.by);
      }
    }
    // Lines the branch added under a line main moved go under it where it is now.
    if (m) after = m.id;
  }
  while (r < regions.length) settle(regions[r++]!);
  if (branchRenames.length) {
    const touched = new Set(ops.flatMap((o) => o.kind === "insert" ? [] : [o.line])), scoped = scopes(main.lines);
    for (const m of main.lines) {
      if (was.has(m.id) || movedIn.has(m.id) || touched.has(m.id) || inRegion(mainPos.get(m.id)!)) continue;
      const t = carry(m.text, branchRenames, loose(m.text), scoped.get(m.id));
      if (t !== m.text) push({ kind: "set", line: m.id, base: m.rev, text: t }, m.by);
    }
  }
  const kept = new Set(branch.lines.map((l) => l.id));
  for (const b of base.lines) {
    if (kept.has(b.id)) continue;
    // Moved on both sides: main's copy stays.
    const m = now.get(b.id) ?? (movedOnBranch.has(b.id) ? undefined : movedOnMain.get(b.id));
    if (!m || inRegion(mainPos.get(m.id)!)) continue;
    // The branch moved it into a stretch both reshaped, and main changed it: the card settles the move, so main's line stays (#1248).
    const to = movedOnBranch.get(b.id);
    if (to && m.text !== b.text && inRegion(branchPos.get(to.id)!)) continue;
    const pick = m.text === b.text || (!now.has(b.id) && m.text.trim() === b.text.trim()) || movedOnBranch.has(b.id) ? "branch" : resolve[b.id], own = written(pick);
    if (!pick) conflicts.push({ line: b.id, base: b.text, main: m.text, branch: null });
    else if (pick === "branch") push({ kind: "delete", line: m.id, base: m.rev }, deleter);
    else if (own) {
      // The branch deleted it, main changed it: a text of the writer's in its place. Main's or both keep main's.
      push({ kind: "set", line: m.id, base: m.rev, text: own[0]! }, writer);
      after = m.id;
      for (const t of own.slice(1)) insert(t, writer);
    }
  }
  if (kind === "keyed") twiceKeyed(main, branch, ops, by, conflicts, resolve, deleter, path);
  conflicts.push(...broken(main, branch, ops, by, path, resolve, !conflicts.length));
  const back = (id: string) => id.startsWith("~") ? id.slice(1) : id;
  return { ops: ops.map((o) => o.kind === "insert" ? { ...o, after: o.after && back(o.after) } : { ...o, line: back(o.line) }), by, conflicts };
}

/**
 * Lines `side` rewrote into something unalike that aren't edits (#1223). A diff pairs a stretch's old and
 * new lines by likeness, so when a block moves out of an `if`, a base line's id can land on whatever took
 * its place while the line itself is new elsewhere. Such a rewrite is a line of its own when the side added
 * the base line's text (indentation aside, and only once in base) once elsewhere: the base line moved.
 */
function rewrites(base: Doc, side: Doc, was: Map<string, Line>) {
  const count = (ls: Line[]) => ls.reduce((m, l) => m.set(l.text.trim(), (m.get(l.text.trim()) ?? 0) + 1), new Map<string, number>());
  const inBase = count(base.lines), added = count(side.lines.filter((l) => !was.has(l.id))), ids = new Set<string>();
  for (const l of side.lines) {
    const b = was.get(l.id), t = b?.text.trim();
    if (!t || alike(t, l.text.trim()) >= 0.5) continue;
    if (inBase.get(t) === 1 && added.get(t) === 1) ids.add(l.id);
  }
  return ids;
}

const unpair = (d: Doc, ids: Set<string>): Doc => ids.size ? { ...d, lines: d.lines.map((l) => ids.has(l.id) ? { ...l, id: `~${l.id}` } : l) } : d;

/** A line that opens or closes a git conflict. `=======` alone is a markdown heading's underline too, so it doesn't count. */
export const MARKER = /^(<{7}|>{7})( |$)/;

/**
 * What a merge won't call clean (#934), as `lint:` conflicts the branch's pick
 * lands anyway: conflict markers it would bring into main (a half-done merge
 * on the branch, like the one #884 committed into features.json), and, once
 * every line is settled (`whole`), a JSON, YAML or TOML file both sides parse
 * that the merged text doesn't. Markers main has already are CI's to catch
 * (scripts/conflict-markers.ts), not every branch's.
 */
function broken(main: Doc, branch: Doc, ops: Op[], by: string[], path: string, resolve: Resolve, whole: boolean): Conflict[] {
  if (!ops.length) return [];
  const merged = structuredClone(main);
  if (!apply(merged, ops, by, 0, main.rev).ok) return [];
  const was = new Map(main.lines.map((l) => [l.id, l.text])), out: Conflict[] = [];
  const marks = merged.lines.flatMap((l, i) => MARKER.test(l.text) && was.get(l.id) !== l.text ? [i + 1] : []);
  if (marks.length && resolve["lint:markers"] !== "branch") out.push({ line: "lint:markers", base: "", main: null, branch: null, lint: `the branch has git's conflict markers in it (line ${marks.join(", ")})` });
  const kind = dataKind(path);
  if (whole && kind && resolve[`lint:${kind}`] !== "branch" && parseError(kind, text(main)) === null && parseError(kind, text(branch)) === null) {
    const why = parseError(kind, text(merged));
    if (why !== null) out.push({ line: `lint:${kind}`, base: "", main: null, branch: null, lint: `merged, it isn't valid ${kind.toUpperCase()} (${why})` });
  }
  return out;
}

type DataKind = "json" | "yaml" | "toml";
/** The data format a merge checks `path` parses as (#934, #986), by its extension. */
export const dataKind = (path: string): DataKind | null => /\.json$/i.test(path) ? "json" : /\.ya?ml$/i.test(path) ? "yaml" : /\.toml$/i.test(path) ? "toml" : null;

/**
 * Why `s` isn't `kind`, or null when it is. Pure JavaScript parsers, so it runs in
 * the Worker (Bun.YAML and Bun.TOML don't); YAML's may hold several documents.
 */
export function parseError(kind: DataKind, s: string): string | null {
  try {
    if (kind === "json") JSON.parse(s);
    else if (kind === "toml") parseToml(s);
    else {
      const e = parseAllDocuments(s, { prettyErrors: false }).flatMap((d) => d.errors)[0];
      if (e) return e.message.split("\n")[0]!;
    }
    return null;
  } catch (e) { return (e as Error).message.split("\n")[0]!; }
}

/**
 * Each line's block: the lines above it that each indent less (a test, the
 * function in it, an object), "" at the top level.
 */
function heads(lines: Line[]): string[] {
  const open: { indent: number; text: string }[] = [];
  return lines.map((l) => {
    const indent = l.text.search(/\S/);
    if (indent >= 0) while (open.length && open.at(-1)!.indent >= indent) open.pop();
    const head = open.map((o) => o.text).join("\n");
    if (indent >= 0) open.push({ indent, text: l.text });
    return head;
  });
}

/**
 * A stretch both sides reshaped, settled line by line where that's safe: each
 * base line paired with its version on each side (its own id, or the most
 * alike line), each pair merged (see blendLine), and every line only one side
 * added kept whole, main's first at a shared spot. The same line added on both
 * sides lands once. Null, a conflict, when a pair won't merge, or a base line
 * is gone on one side and changed on the other, or gone at all in code
 * (`strict`), where the other side's new lines may lean on it, or when in code
 * both sides edited links of one `? :` or `&&` chain: each side's clauses can
 * come out whole and the merge still skip one (#1168, config-schema.ts).
 */
function blend(bl: Line[], ms: Line[], bs: Line[], strict: boolean, loose: (t: string) => boolean) {
  // Its own id, unless a line the side rewrote it into is more alike (a one-liner reflowed, an id handed to the wrong line).
  const pair = (side: Line[]) => {
    let from = 0;
    return bl.map((b) => {
      let best = side.findIndex((l, i) => i >= from && l.id === b.id), score = best < 0 ? 0.5 : Math.max(alike(b.text, side[best]!.text), 0.5);
      for (let i = from; i < side.length; i++) {
        const like = alike(b.text, side[i]!.text);
        if (like > score) { best = i; score = like; }
      }
      if (best >= 0) from = best + 1;
      return best;
    });
  };
  if (strict && relinked(bl, ms, bs)) return null;
  const pm = pair(ms), pb = pair(bs), out: { m?: Line; text: string; by: string }[] = [];
  // Main's lines no base line paired with: a branch line that's the same lands once.
  const mainOnly = new Map<string, number>();
  ms.forEach((m, i) => { if (!pm.includes(i)) mainOnly.set(m.text, (mainOnly.get(m.text) ?? 0) + 1); });
  let i = 0, j = 0;
  const upTo = (x: number, y: number) => {
    while (i < x) { const m = ms[i++]!; out.push({ m, text: m.text, by: m.by }); }
    while (j < y) {
      const l = bs[j++]!, n = mainOnly.get(l.text) ?? 0;
      if (n) mainOnly.set(l.text, n - 1);
      else out.push({ text: l.text, by: l.by });
    }
  };
  for (const [k, b] of bl.entries()) {
    const m = ms[pm[k]!], l = bs[pb[k]!];
    if (m && l) {
      const text = m.text === l.text || l.text === b.text ? m.text : m.text === b.text ? l.text : blendLine(b.text, m.text, l.text, loose(b.text));
      if (text === null) return null;
      upTo(pm[k]!, pb[k]!);
      out.push({ m, text, by: text === m.text ? m.by : l.by });
      i++; j++;
      continue;
    }
    // Gone on one side: dropped, if the other side left it as it was.
    if (strict || (m ?? l) && (m ?? l)!.text !== b.text) return null;
    if (m) { upTo(pm[k]!, j); i++; }
    if (l) { upTo(i, pb[k]!); j++; }
  }
  upTo(ms.length, bs.length);
  return out;
}

/** Both sides edited links of one `? :` or `&&` chain (#1168). */
function relinked(bl: Line[], ms: Line[], bs: Line[]) {
  const was = new Map(bl.map((b) => [b.id, b.text]));
  const edits = (side: Line[]) => side.some((l) => was.get(l.id) !== l.text && LINK.test(l.text));
  return edits(ms) && edits(bs);
}

/**
 * A statement one side joined onto one line or wrapped onto several, and the other side only edited (#1256):
 * each side's lines read as one text, merged word by word (see blendLine), laid out the way the side that
 * moved the line breaks did. Null when it won't merge, or when it's more than a statement (four lines a side).
 */
function rejoin(bl: Line[], ms: Line[], bs: Line[], strict: boolean, loose: (t: string) => boolean) {
  const kept = (side: Line[]) => side.length === bl.length && side.every((l, i) => l.id === bl[i]!.id);
  if (!bl.length || !ms.length || !bs.length || Math.max(bl.length, ms.length, bs.length) > 4 || kept(ms) === kept(bs) || (strict && relinked(bl, ms, bs))) return null;
  const join = (ls: Line[]) => ls.map((l) => l.text).join("\n");
  const text = blendLine(join(bl), join(ms), join(bs), loose(bl[0]!.text), true);
  // Main's lines take the merged text in order; the branch wrote what main didn't have.
  return text?.split("\n").map((t, k) => ({ m: ms[k], text: t, by: t === ms[k]?.text ? ms[k]!.by : (bs[k] ?? bs.at(-1))!.by }));
}

/** A link of a multi-line `? :`, `&&`, `||` or `??` chain: a line that opens with one, or ends on one. */
const LINK = /^\s*(\?\s|:\s|&&|\|\||\?\?)|(\s\?|&&|\|\||\?\?)\s*$/;

/** Both changed a lockfile: keep main's, swap in the branch's whole, or report it. Either way it's regenerated after. */
function wholeFile(branch: Doc, main: Doc, pick: "branch" | "main" | undefined, deleter: string) {
  const ops: Op[] = [], by: string[] = [];
  if (!pick) return { ops, by, conflicts: [{ line: "file", base: "", main: null, branch: null, whole: true as const }] };
  if (pick === "branch") {
    let after: string | null = null, next = main.nextId;
    for (const m of main.lines) { ops.push({ kind: "delete", line: m.id, base: m.rev }); by.push(deleter); }
    for (const l of branch.lines) { ops.push({ kind: "insert", after, text: l.text }); by.push(l.by); after = `L${next++}`; }
  }
  return { ops, by, conflicts: [] as Conflict[] };
}

/**
 * Config keys the merge would define twice (more times than either side
 * does): a conflict each, `key:<path>`. Settled as main, the merge's new
 * copies are dropped; as the branch, main's are.
 */
function twiceKeyed(main: Doc, branch: Doc, ops: Op[], by: string[], conflicts: Conflict[], resolve: Resolve, deleter: string, path: string) {
  const d = structuredClone(main);
  if (!apply(d, ops, by).ok) return;
  const count = (doc: Doc) => { const c = new Map<string, number>(); for (const k of keys(doc.lines.map((l) => l.text), path)) if (k) c.set(k, (c.get(k) ?? 0) + 1); return c; };
  const inMain = count(main), inBranch = count(branch), was = new Map(main.lines.map((l) => [l.id, l.text]));
  const k = keys(d.lines.map((l) => l.text), path);
  for (const [key, n] of count(d)) {
    if (n <= Math.max(inMain.get(key) ?? 0, inBranch.get(key) ?? 0)) continue;
    const lines = d.lines.filter((_, i) => k[i] === key), mains = lines.filter((l) => was.get(l.id) === l.text);
    const pick = resolve[`key:${key}`];
    if (!pick) {
      const side = (doc: Doc) => doc.lines.filter((_, i) => keys(doc.lines.map((l) => l.text), path)[i] === key).map((l) => l.text).join("\n") || null;
      conflicts.push({ line: `key:${key}`, base: "", main: side(main), branch: side(branch) });
      continue;
    }
    const drop = pick === "main" ? lines.filter((l) => !mains.includes(l)) : mains;
    for (const l of drop) {
      // In JSON the line above may have gained a comma only for the line we drop: give it back main's text.
      const above = d.lines[d.lines.indexOf(l) - 1], had = above && was.get(above.id);
      if (pick === "main" && above && had !== undefined && above.text !== had && above.text.replace(/,\s*$/, "") === had.replace(/,\s*$/, "")) {
        ops.push({ kind: "set", line: above.id, base: above.rev, text: had }); by.push(deleter);
      }
      ops.push({ kind: "delete", line: l.id, base: l.rev }); by.push(deleter);
    }
  }
}

/**
 * Each line's config key, with its parents for nested formats (`a.b.c`), or
 * null: `NAME=` in .env, `key =` under `[section]` in TOML, `"key":` or
 * `key:` by indentation in JSON and YAML.
 */
function keys(lines: string[], path: string): (string | null)[] {
  const env = /(^|\/)\.env|\.env$/i.test(path), toml = /\.toml$/i.test(path);
  const stack: { indent: number; key: string }[] = [];
  let section = "";
  return lines.map((t) => {
    if (env) return t.match(/^\s*(?:export\s+)?([A-Za-z_][\w.]*)\s*=/)?.[1] ?? null;
    if (toml) {
      const s = t.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
      if (s) { section = s[1]!.trim(); return null; }
      const m = t.match(/^\s*("[^"]*"|[\w.-]+)\s*=/);
      return m ? `${section}.${m[1]}` : null;
    }
    const m = t.match(/^(\s*)(?:-\s+)?(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([\w@./-]+))\s*:(?!\/)/);
    if (!m) return null;
    const indent = m[1]!.length, key = m[2] ?? m[3] ?? m[4]!;
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const full = [...stack.map((s) => s.key), key].join(".");
    stack.push({ indent, key });
    return full;
  });
}

/**
 * Lines `side` moved since `base`: each base line it deleted whose text it
 * inserted elsewhere, by base id. Indentation doesn't count: a block moved out
 * of an `if` is a move (#1223). An unambiguous text (one deleted, one added,
 * not blank) is a move on its own; the deleted lines around a move that match
 * the added lines around it, blank or repeated (`}`), moved with it.
 */
function moves(base: Doc, side: Doc, was: Map<string, Line>) {
  const has = new Set(side.lines.map((l) => l.id));
  const gone = new Map<string, string[]>(), added = new Map<string, Line[]>();
  for (const l of base.lines) if (!has.has(l.id) && l.text.trim()) gone.set(l.text.trim(), [...gone.get(l.text.trim()) ?? [], l.id]);
  for (const l of side.lines) if (!was.has(l.id) && l.text.trim()) added.set(l.text.trim(), [...added.get(l.text.trim()) ?? [], l]);
  const out = new Map<string, Line>();
  for (const [t, ids] of gone) {
    const to = added.get(t);
    if (ids.length === 1 && to?.length === 1) out.set(ids[0]!, to[0]!);
  }
  // Grow each move into the block it came with, a line at a time either way.
  const bi = new Map(base.lines.map((l, i) => [l.id, i])), si = new Map(side.lines.map((l, i) => [l.id, i]));
  const into = new Set([...out.values()].map((l) => l.id)), todo = [...out];
  while (todo.length) {
    const [id, to] = todo.pop()!;
    for (const d of [-1, 1]) {
      const b = base.lines[bi.get(id)! + d], s = side.lines[si.get(to.id)! + d];
      if (!b || !s || has.has(b.id) || out.has(b.id) || was.has(s.id) || into.has(s.id) || b.text.trim() !== s.text.trim()) continue;
      out.set(b.id, s); into.add(s.id); todo.push([b.id, s]);
    }
  }
  return out;
}

// Positions against base: base line i at 2i + 1, the gap after it at 2i + 2, the top at 0.
interface Region { lo: number; hi: number; holes?: Region[] }
/** Whether `p` is in `g` and not in one of its holes. */
const covers = (g: Region, p: number) => g.lo <= p && p <= g.hi && !g.holes?.some((h) => h.lo <= p && p <= h.hi);
interface Hunk extends Region { reshaped: boolean; deletes: boolean }

/** Where each line of `side` sits against base: a base line at its own spot, a new line in the gap it was added to. */
function places(base: Doc, side: Doc) {
  const at = new Map(base.lines.map((l, i) => [l.id, i])), pos = new Map<string, number>();
  let gap = 0;
  for (const l of side.lines) {
    const i = at.get(l.id);
    if (i === undefined) pos.set(l.id, gap);
    else { pos.set(l.id, 2 * i + 1); gap = 2 * i + 2; }
  }
  return pos;
}

/**
 * What `side` changed, as runs: a changed line on its own, and added and
 * deleted lines joined with whatever they touch. Moves are left out (they
 * merge on their own). `reshaped` marks a run with lines added or deleted.
 */
function hunks(base: Doc, side: Doc, pos: Map<string, number>, moved: Map<string, Line>) {
  const now = new Map(side.lines.map((l) => [l.id, l])), into = new Set([...moved.values()].map((l) => l.id));
  const ids = new Set(base.lines.map((l) => l.id)), items: Hunk[] = [];
  base.lines.forEach((b, i) => {
    const s = now.get(b.id);
    if (!s) { if (!moved.has(b.id)) items.push({ lo: 2 * i, hi: 2 * i + 2, reshaped: true, deletes: true }); }
    else if (s.text !== b.text) items.push({ lo: 2 * i + 1, hi: 2 * i + 1, reshaped: false, deletes: false });
  });
  for (const l of side.lines) if (!ids.has(l.id) && !into.has(l.id)) items.push({ lo: pos.get(l.id)!, hi: pos.get(l.id)!, reshaped: true, deletes: false });
  items.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const out: Hunk[] = [];
  for (const h of items) {
    const last = out.at(-1);
    if (last && h.lo <= last.hi + 1) { last.hi = Math.max(last.hi, h.hi); last.reshaped ||= h.reshaped; last.deletes ||= h.deletes; }
    else out.push({ ...h });
  }
  return out;
}

/**
 * Stretches both sides reshaped: runs that share a line where either added or
 * deleted lines, or a line added inside a run the other side reshaped. Two
 * plain edits to one line are left to the word merge, and lines added at the
 * same spot on both sides just land in order. `strict` (code) also counts
 * lines added at either edge of a run the other side deleted lines in.
 * Sorted, and joined where they meet.
 */
function clashes(main: Hunk[], branch: Hunk[], strict: boolean): Region[] {
  const inside = (p: Hunk, q: Hunk) => p.lo === p.hi && (strict && q.deletes ? q.lo <= p.lo && p.lo <= q.hi : q.lo < p.lo && p.lo < q.hi);
  const found: Region[] = [];
  for (const x of main) for (const y of branch) {
    if (y.lo > x.hi + 1) break;
    const lo = Math.max(x.lo, y.lo), hi = Math.min(x.hi, y.hi), line = lo < hi || (lo === hi && lo % 2 === 1);
    if ((line && (x.reshaped || y.reshaped)) || inside(x, y) || inside(y, x)) found.push({ lo: Math.min(x.lo, y.lo), hi: Math.max(x.hi, y.hi) });
  }
  found.sort((a, b) => a.lo - b.lo);
  const out: Region[] = [];
  for (const g of found) {
    const last = out.at(-1);
    if (last && g.lo <= last.hi) last.hi = Math.max(last.hi, g.hi);
    else out.push({ ...g });
  }
  return out;
}

type Side = [Doc, Map<string, number>, Map<string, Line>];

/**
 * Stretches split only by base lines one side moved away, joined into one, with each gap as a hole (#1237).
 * Each would be its own card, though it's one decision. What's in a hole is left out of the card, on both
 * sides: the moved lines land where the side moved them, and the other side's new lines there go with them.
 * The side that moved them has nothing left in the gap, and the other side has only those lines and new ones.
 */
function joined(regions: Region[], base: Doc, ...sides: [Side, Side]): Region[] {
  const out: Region[] = [];
  // Base line i sits at 2i + 1: a gap with none in it is no gap.
  const hole = (lo: number, hi: number) => (lo % 2 ? lo : lo + 1) <= hi && sides.some(([d, pos, moved], k) => {
    for (let p = lo % 2 ? lo : lo + 1; p <= hi; p += 2) if (!moved.has(base.lines[(p - 1) / 2]!.id)) return false;
    const [o, opos, omoved] = sides[1 - k]!, into = new Set([...omoved.values()].map((l) => l.id));
    const at = (q: Map<string, number>) => (l: Line) => lo <= q.get(l.id)! && q.get(l.id)! <= hi;
    // A line the other side moved into the gap is a move of its own, best left a card's.
    return !d.lines.some(at(pos)) && o.lines.filter(at(opos)).every((l) => moved.has(l.id) || !into.has(l.id));
  });
  for (const g of regions) {
    const last = out.at(-1);
    if (last && hole(last.hi + 1, g.lo - 1)) out[out.length - 1] = { lo: last.lo, hi: g.hi, holes: [...last.holes ?? [], { lo: last.hi + 1, hi: g.lo - 1 }, ...g.holes ?? []] };
    else out.push(g);
  }
  return out;
}

const words = (s: string) => s.match(/\s+|\w+|[^\s\w]/g) ?? [];
// Words too common in prose to say anything was renamed.
const STOP = new Set("the and for with that this its are was were but not from into onto than then when what which who how why each all any one our your their has have had can will".split(" "));
/** A comment line: in code, its words are prose. */
const remark = (t: string) => /^\s*(\/\/|\/\*|\*|#\s|<!--)/.test(t);
// The keys a list adds (`digs: []`, `rank?: string[]`): two sides adding one key two ways can't both land.
const keysOf = (ws: string[]) => new Set([...ws.join("").matchAll(/([\w$]+)\??\s*:(?!:)/g)].map((m) => m[1]!));
/** Was `line` a sorted list: three or more comma-separated names in order? Then adds go in sorted too. */
function sorted(line: string) {
  const parts = line.split(","), names = parts.map((p, i) => (i ? p.match(/[\w$]+/) : p.match(/[\w$]+(?=[^\w$]*$)/))?.[0]?.toLowerCase());
  return names.length >= 3 && names.every((n, i) => n && (!i || names[i - 1]! <= n));
}

const indent = (t: string) => t.match(/^\s*/)![0];
const sortKey = (t: string) => t.trim().toLowerCase();
/**
 * The sorted blocks among `lines`: three or more non-blank lines in a row at
 * one indentation, in order (an import block, keys one per line). Each line
 * of one maps to it; new lines both sides add there go in sorted too.
 */
function runs(lines: Line[]) {
  const out: ({ indent: string } | undefined)[] = [];
  for (let i = 0; i < lines.length;) {
    const at = indent(lines[i]!.text);
    let j = i + 1;
    while (j < lines.length && lines[i]!.text.trim() && lines[j]!.text.trim() && indent(lines[j]!.text) === at) j++;
    const block = lines.slice(i, j).map((l) => sortKey(l.text)), r = block.length >= 3 && block.every((k, n) => !n || block[n - 1]! <= k) ? { indent: at } : undefined;
    for (; i < j; i++) out.push(r);
  }
  return out;
}

/**
 * Two edits of one line, merged word by word: each side's changes to `base`
 * as spans of words, applied together. Null when the spans overlap or touch
 * (unless both made the very same change), or when a word one side replaced
 * is one the other side adds (a rename on one side, a new use of the old
 * name on the other): that's a real conflict. With `loose` (prose and
 * comments), that guard skips short and common words ("a", "it", "the"),
 * but never a number: a sentence both sides edited in different words
 * merges (#1222), unless one changed a number the other's new words quote.
 *
 * With `both`, words both sides only added at the very same spot are kept: an
 * item each added to one list, `a`'s first (main's: it landed first), or in
 * order if the list was sorted. Refused if both add the same key, or in code
 * if the two would regroup an expression (see regroups).
 *
 * With `moved` (a statement one side joined or wrapped, see rejoin), a word a
 * side took out but still has elsewhere in its text was moved, not renamed away,
 * as in prose.
 */
export function mergeWords(base: string, a: string, b: string, both = false, loose = false, moved = loose): string | null {
  const o = words(base);
  const spans = (x: string[]) => {
    const out: { from: number; to: number; add: string[] }[] = [];
    let i = -1, j = -1;
    for (const p of [...keptPairs(o, x), { i: o.length, j: x.length }]) {
      if (p.i > i + 1 || p.j > j + 1) out.push({ from: i + 1, to: p.i, add: x.slice(j + 1, p.j) });
      i = p.i;
      j = p.j;
    }
    return out;
  };
  const wa = words(a), wb = words(b), sa = spans(wa), sb = spans(wb);
  // A number always says something, however short: "up to 32" made 64 on one side, a new "room of 32" on the other (#1222).
  const named = (ws: string[]) => new Set(ws.filter((w) => /\w/.test(w) && (!loose || /\d/.test(w) || (w.length >= 3 && !STOP.has(w.toLowerCase())))));
  // In prose a word is only renamed away if it's gone from that side's line: one "Jekyll" of two cut is no rename.
  const gone = (ss: typeof sa, x: string[]) => new Set([...named(ss.flatMap((s) => o.slice(s.from, s.to)))].filter((w) => !moved || !x.includes(w)));
  const added = (ss: typeof sa) => named(ss.flatMap((s) => s.add));
  const clash = (x: Set<string>, y: Set<string>) => [...x].some((w) => y.has(w));
  if (clash(gone(sa, wa), added(sb)) || clash(gone(sb, wb), added(sa))) return null;
  const all = [...sa, ...sb].sort((p, q) => p.from - q.from || p.to - q.to);
  const inOrder = both && sorted(base), first = (ws: string[]) => ws.join("").match(/[\w$]+/)?.[0]?.toLowerCase() ?? "";
  let out = "", i = 0, last: (typeof all)[number] | null = null;
  for (const s of all) {
    if (last && s.from <= last.to) {
      if (s.from === last.from && s.to === last.to && s.add.join("") === last.add.join("")) continue;
      // Two inserts at one spot (the sort is stable, so a's came first): b's goes after a's, or before it in a sorted list.
      if (both && s.from === s.to && last.from === last.to && s.from === last.from && !clash(keysOf(s.add), keysOf(last.add)) && (loose || !regroups(last.add, s.add))) {
        const add = s.add.join("");
        if (inOrder && first(s.add) < first(last.add)) out = out.slice(0, out.length - last.add.join("").length) + add + last.add.join("");
        else out += add;
        continue;
      }
      return null;
    }
    out += o.slice(i, s.from).join("") + s.add.join("");
    i = s.to;
    last = s;
  }
  return out + o.slice(i).join("");
}

/**
 * Would two inserts at one spot in code change how an expression groups (#1255)? Yes if they
 * join with different ones of `&&`, `||` and `??` (spliced, the other's clause hangs off
 * this one's), or one joins with any and the other opens or closes a paren it doesn't close
 * or open (each side wrapped the same expression its own way, and a `!` lands on the wrong
 * group). Strings don't count.
 */
function regroups(a: string[], b: string[]) {
  const read = (ws: string[]) => {
    const t = ws.join("").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "\"\"");
    const joins = new Set<string>();
    let d = 0, low = 0;
    for (const [i, c] of [...t].entries()) {
      if (c === "(") d++;
      else if (c === ")") low = Math.min(low, --d);
      // Outside its own parens: `) && x` joins, `(a && b` doesn't.
      else if (d <= 0 && "&|?".includes(c) && c === t[i + 1] && c !== t[i - 1]) joins.add(c);
    }
    return { joins, open: d !== 0 || low < 0 };
  };
  const x = read(a), y = read(b);
  if (!x.joins.size && !y.joins.size) return false;
  return x.open || y.open || (x.joins.size > 0 && y.joins.size > 0 && new Set([...x.joins, ...y.joins]).size > 1);
}

/**
 * A name one side renamed across the file: `from`, as a property (`.from`) or not, now `to` (a name or a dotted path).
 * One with a `scope` was renamed only in the function whose head line has that id (#1257); a `call` one is an
 * expression, `f(x)`, the side hoisted into a new `const to = f(…)` there. A `moved` one is a local whose lines moved
 * into a new function returning it, `to` being its field of what the call gave (#1265), `at` the head's id on the side if the
 * function moved too; comments keep the old word.
 */
interface Rename { from: string; dotted: boolean; to: string; scope?: string; call?: boolean; moved?: boolean; at?: string }

/** `t` with each use of the renamed name swapped for the new one. */
function renamed(t: string, r: Rename) {
  if (r.call) return t.replace(new RegExp(`(?<![\\w$.])${r.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"), r.to);
  const ws = words(t);
  return ws.map((w, i) => w === r.from && (ws[i - 1] === ".") === r.dotted && ws[i + 1] !== "$" && ws[i - 1] !== "$" ? r.to : w).join("");
}

/** A line that opens a function: `function f(`, `f = (…) =>`, or a method `f(…) {`. */
const FN = /\bfunction\b|=>\s*\{?\s*$|^\s*(?:(?:async|static|public|private|protected|get|set)\s+)*\*?(?!(?:if|for|while|switch|catch|with|return)\b)[A-Za-z_$][\w$]*\s*\([^;]*\)\s*(?::[^=;{]+)?\{\s*$/;

/** Each line's function: the id of the outermost function head over it by indentation (its own, for a head), null at the top. */
function scopes(lines: Line[]): Map<string, string | null> {
  const open: { indent: number; id: string; fn: boolean }[] = [], out = new Map<string, string | null>();
  for (const l of lines) {
    const indent = l.text.search(/\S/), fn = indent >= 0 && FN.test(l.text);
    if (indent >= 0) while (open.length && open.at(-1)!.indent >= indent) open.pop();
    out.set(l.id, open.find((o) => o.fn)?.id ?? (fn ? l.id : null));
    if (indent >= 0) open.push({ indent, id: l.id, fn });
  }
  return out;
}

/** The new `const to = f(…)` a hoist leaves behind: not a use of the expression it replaced. */
const hoisted = (t: string, r: Rename) => !!r.call && new RegExp(`^\\s*(?:const|let)\\s+${r.to}\\s*=\\s*${r.from.slice(0, r.from.indexOf("("))}\\s*\\(`).test(t);

/**
 * The names `side` renamed across the file (#1156): a line it changed where one
 * word became a name or dotted path (`.hero` to `.heroes.marines`), the same swap
 * turning two or more of base's lines into the side's, and no use of the old name,
 * as a property or not as before, left on that side. In prose (`loose`) the
 * name must say something, as in mergeWords' guard.
 *
 * Or within one function (#1257): a local or parameter of it in base, renamed on
 * two or more of its lines with no use left in it, though other functions keep a
 * name of their own like it. Or an expression, `f(x)`, the side swapped for `name`
 * on every line of a function where it also added `const name = f(…)`.
 *
 * Or moved out (#1265): a local declared in a function whose lines, by id, now sit
 * in a function the side added, which returns `{ name }`, while the old function
 * gained `const run = g(…)`: there `name` reads `run.name`, if no use is left in it.
 */
function renames(base: Doc, side: Doc, loose: (t: string) => boolean, moved: Map<string, Line>): Rename[] {
  const now = new Map(side.lines.map((l) => [l.id, l.text])), seen = new Map<string, Rename>();
  const inSide = scopes(side.lines), inBase = scopes(base.lines), was = new Set(base.lines.map((l) => l.id));
  for (const b of base.lines) {
    const s = now.get(b.id);
    if (s === undefined || s === b.text) continue;
    const o = words(b.text), n = words(s);
    let p = 0, q = 0;
    while (p < o.length && p < n.length && o[p] === n[p]) p++;
    while (q < o.length - p && q < n.length - p && o[o.length - 1 - q] === n[n.length - 1 - q]) q++;
    // `dry` to `run.dry` reads as `run.` put in front: the name it went in front of is the one renamed.
    if (p + q === o.length && q > 0) q--;
    const from = o.slice(p, o.length - q), to = n.slice(p, n.length - q).join("");
    if (!/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(to)) continue;
    const scope = inSide.get(b.id) ?? undefined;
    if (from.length > 3 && /^[A-Za-z_]\w*$/.test(from[0]!) && from[1] === "(" && from.at(-1) === ")" && /^\w+$/.test(to) && scope && balanced(from.slice(1))) {
      const r: Rename = { from: from.join(""), dotted: false, to, scope, call: true };
      seen.set(`${r.from} call ${r.to} ${scope}`, r);
      continue;
    }
    if (from.length !== 1 || !/^[A-Za-z_]\w*$/.test(from[0]!)) continue;
    if (loose(b.text) && (from[0]!.length < 3 || STOP.has(from[0]!.toLowerCase()))) continue;
    const r = { from: from[0]!, dotted: o[p - 1] === ".", to };
    seen.set(`${r.from} ${r.dotted} ${r.to}`, r);
    if (!r.dotted && scope) seen.set(`${r.from} ${r.dotted} ${r.to} ${scope}`, { ...r, scope });
  }
  for (const r of extracted(base, side, moved, inBase, inSide, was)) seen.set(`${r.from} moved ${r.to} ${r.scope}`, r);
  const all = [...seen.values()];
  const within = (r: Rename) => (id: string, scoped: Map<string, string | null>) => !r.scope || scoped.get(id) === (r.at ?? r.scope);
  const swaps = (r: Rename) => base.lines.filter((b) => within(r)(b.id, inSide) && b.text !== now.get(b.id) && renamed(b.text, r) === now.get(b.id)).length;
  const left = (r: Rename) => side.lines.some((l) => within(r)(l.id, inSide) && !(r.moved && loose(l.text)) && !hoisted(l.text, r) && renamed(l.text, r) !== l.text);
  const kept = all.filter((r) => !left(r) && (r.moved || (r.call
    ? swaps(r) >= 1 && side.lines.some((l) => !was.has(l.id) && inSide.get(l.id) === r.scope && hoisted(l.text, r))
    : swaps(r) >= 2 && (!r.scope || base.lines.some((b) => inBase.get(b.id) === r.scope && declares(b.text, r.from, b.id === r.scope)))))
    // One name renamed two ways (`hero` to `heroes.a` here, `heroes.b` there) isn't one swap.
    && !all.some((x) => x !== r && x.from === r.from && x.dotted === r.dotted && x.to !== r.to && (!r.scope || !x.scope || x.scope === r.scope)));
  // A rename that holds across the file needs no scope.
  return kept.filter((r) => !r.scope || r.call || !kept.some((x) => !x.scope && x.from === r.from && x.dotted === r.dotted && x.to === r.to));
}

/**
 * The locals `side` moved out of a function into one it added (#1265): `f` declared `name` in base, lines of it using
 * `name` now sit (kept or moved) in a new function `g` that declares it and returns `{ name }`, and `f` on the side
 * has `const run = g(…)`: read as `name` to `run.name` in `f`.
 */
function extracted(base: Doc, side: Doc, moved: Map<string, Line>, inBase: Map<string, string | null>, inSide: Map<string, string | null>, was: Set<string>): Rename[] {
  const text = new Map(side.lines.map((l) => [l.id, l.text])), out: Rename[] = [];
  // Where a base line is on the side: kept, or moved (a delete and an insert, `moves`).
  const there = (id: string) => text.has(id) ? id : moved.get(id)?.id, into = new Set([...moved.values()].map((l) => l.id));
  for (const g of side.lines) {
    if (was.has(g.id) || into.has(g.id) || inSide.get(g.id) !== g.id) continue;
    const fn = /\bfunction\s*\*?\s*([\w$]+)|([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>|^\s*(?:async\s+)?([\w$]+)\s*\(/.exec(g.text);
    const name = fn?.[1] ?? fn?.[2] ?? fn?.[3];
    if (!name) continue;
    const body = side.lines.filter((l) => inSide.get(l.id) === g.id);
    if (!body.some((l) => /\breturn\b/.test(l.text))) continue;
    // Each local `g` declares and returns in `{ … }`, and the functions whose lines using it moved into `g`.
    for (const local of body.flatMap((l) => /^\s*(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/.exec(l.text)?.[1] ?? [])) {
      if (!body.some((l) => /\breturn\b/.test(l.text) && new RegExp(`[{,]\\s*${local}\\s*[,}:]`).test(l.text))) continue;
      const from = new Set(base.lines.flatMap((b): string[] => {
        const f = inBase.get(b.id), now = there(b.id);
        return f && f !== b.id && now && inSide.get(now) === g.id && words(b.text).some((w) => w === local) ? [f] : [];
      }));
      for (const f of from) {
        const at = there(f);
        if (!at || !base.lines.some((b) => inBase.get(b.id) === f && declares(b.text, local, b.id === f))) continue;
        const call = side.lines.find((l) => inSide.get(l.id) === at && new RegExp(`^\\s*(?:const|let|var)\\s+[A-Za-z_]\\w*\\s*=\\s*(?:await\\s+)?${name.replace(/\$/g, "\\$")}\\s*\\(`).test(l.text));
        const run = call && /^\s*(?:const|let|var)\s+([A-Za-z_]\w*)/.exec(call.text)![1]!;
        if (run && run !== local) out.push({ from: local, dotted: false, to: `${run}.${local}`, scope: f, moved: true, ...(at !== f && { at }) });
      }
    }
  }
  return out;
}

/** Do the words `ws`, `(` first, close the paren they open at the end and nowhere before? */
function balanced(ws: string[]) {
  let d = 0;
  for (let i = 0; i < ws.length; i++) {
    d += ws[i] === "(" ? 1 : ws[i] === ")" ? -1 : 0;
    if (d === 0 && i < ws.length - 1) return false;
  }
  return d === 0;
}

/** Does `t` declare `name`: a `const`, `let` or `var` of it, or, on the function's `head` line, a parameter? */
const declares = (t: string, name: string, head: boolean) =>
  new RegExp(`\\b(?:const|let|var)\\b[^=]*\\b${name}\\b`).test(t) || (head && new RegExp(`\\([^)]*\\b${name}\\b`).test(t));

/** `t`, a line one side added in the function `scope`, with the other side's renames carried into it. Prose and comments skip short and common words. */
const carry = (t: string, rs: Rename[], loose: boolean, scope: string | null | undefined) =>
  rs.reduce((s, r) => (r.scope && r.scope !== scope) || (loose && (r.moved || r.from.length < 3 || STOP.has(r.from.toLowerCase()))) ? s : renamed(s, r), t);

/**
 * One line both changed: word by word, else as a list both added items to (see mergeWords).
 * An `import type { … }` one side turned into `import { x, type … }` is read that way on
 * the other side too, so the names it added keep their `type` (#1168, build.ts).
 */
function blendLine(base: string, a: string, b: string, loose: boolean, moved = loose) {
  if (TYPE_ONLY.test(base) && TYPE_ONLY.test(a) !== TYPE_ONLY.test(b)) [base, a, b] = [base, a, b].map(inlineTypes) as [string, string, string];
  return mergeWords(base, a, b, false, loose, moved) ?? mergeWords(base, a, b, true, loose, moved);
}
const TYPE_ONLY = /^(\s*import\s+)type\s*\{([^}]*)\}/;
const inlineTypes = (t: string) => t.replace(TYPE_ONLY, (_, at: string, list: string) => `${at}{${list.split(",").map((n) => n.replace(/^(\s*)(?=\S)/, "$1type ")).join(",")}}`);

/**
 * A conflict as the review shows it: which picks settle it (`text` is
 * `{text}`), and for one line both sides only added words to at the same spot,
 * a `suggestion` that keeps both, main's words first.
 */
export function explain(c: Conflict): Conflict & { choices: string[]; suggestion?: string } {
  const sides = !!(c.whole || c.lint || c.line.startsWith("key:"));
  const choices = sides ? ["main", "branch"] : c.doubled ? ["main", "branch", "text"] : [...PICKS, "text"];
  const one = (x: string | null): x is string => x !== null && !x.includes("\n");
  const suggestion = !sides && !c.doubled && one(c.main) && one(c.branch) && one(c.base) && c.main !== c.branch ? mergeWords(c.base, c.main, c.branch, true) : null;
  return { ...c, choices, ...(suggestion !== null && { suggestion }) };
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
