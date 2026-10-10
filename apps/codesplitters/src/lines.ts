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

/**
 * A conflict, keyed by `line`: a base line (the first of a stretch both sides
 * rewrote), a new branch line main also added (`doubled`), `key:<path>` for a
 * config key the merge would define twice, or `file` for a lockfile both
 * changed (`whole`: keep one side, then regenerate it), or `lint:<problem>`
 * for merged code that would no longer build (`lint`, from lint.ts).
 */
export interface Conflict { line: string; base: string; main: string | null; branch: string | null; doubled?: true; whole?: true; lint?: string }

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
 * the same words (one re-indents, the other changes an argument). A moved
 * line or block (deleted and the same text inserted elsewhere) keeps the
 * other side's edit, and lines the branch added under a line main moved go
 * under it where it is now. The same new line added at the same spot on both sides lands once.
 *
 * Conflicts, each settled by `resolve` (by its `line`, keeping the branch's
 * or main's version) or left out and reported:
 * - a stretch both sides reshaped: lines added or deleted on one side where
 *   the other changed a line too (one changed a line the other deleted, or
 *   both rewrote a function). The whole stretch is one conflict, as in git.
 * - one line both rewrote in the same words.
 * - the same line added on both sides in different places (`doubled`): it
 *   would land twice.
 * - by `path` (see `kindOf`): a lockfile both changed is one whole-file
 *   conflict, since a line merge of one is never valid; a config key (.env,
 *   JSON, YAML, TOML) the merge would define twice is a conflict; and in code,
 *   lines added right next to lines the other side deleted are a conflict too
 *   (the deleted lines may be what the new ones use). Prose is left loose.
 *
 * Other new lines never conflict: each goes after the nearest line before it
 * that main still has. Inserts are given the ids main will assign them, so
 * the batch must land on `main` exactly as passed. Deleted lines leave no
 * blame, so their ops are credited to `deleter`.
 */
export function merge(base: Doc, branch: Doc, main: Doc, resolve: Record<string, "branch" | "main"> = {}, deleter = "anon", path = "") {
  const kind = kindOf(path);
  if (kind === "lock") {
    const [b, m, br] = [base, main, branch].map(text);
    if (b !== m && b !== br && m !== br) return wholeFile(branch, main, resolve.file, deleter);
  }
  const was = new Map(base.lines.map((l) => [l.id, l])), now = new Map(main.lines.map((l) => [l.id, l]));
  const at = new Map(main.lines.map((l, i) => [l.id, i]));
  const movedOnMain = moves(base, main, was), movedOnBranch = moves(base, branch, was);
  const moveOf = new Map([...movedOnBranch].map(([id, l]) => [l.id, id]));
  const mainPos = places(base, main), branchPos = places(base, branch);
  const regions = clashes(hunks(base, main, mainPos, movedOnMain), hunks(base, branch, branchPos, movedOnBranch), kind !== "prose");
  const inRegion = (p: number) => regions.some((g) => g.lo <= p && p <= g.hi);
  // Lines main added that weren't in the file already: a line that already repeats (a test's setup call) is no sign of doubling.
  const before = new Set(base.lines.map((l) => l.text));
  const mainAdded = new Set(main.lines.filter((l) => !was.has(l.id) && !before.has(l.text)).map((l) => l.text));
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
  // A stretch both reshaped: keep main's as is, or swap in the branch's whole.
  const settle = (g: Region) => {
    const within = (d: Doc, pos: Map<string, number>) => d.lines.filter((l) => g.lo <= pos.get(l.id)! && pos.get(l.id)! <= g.hi);
    const ms = within(main, mainPos), bs = within(branch, branchPos), key = base.lines[Math.ceil((g.lo - 1) / 2)]!.id;
    const join = (ls: Line[]) => ls.length ? ls.map((l) => l.text).join("\n") : null;
    // Both reshaped it the same way: nothing to do.
    const pick = join(ms) === join(bs) ? "main" : resolve[key];
    if (pick === "branch") {
      if (after === null || now.has(after)) after = main.lines.filter((l) => mainPos.get(l.id)! < g.lo).at(-1)?.id ?? null;
      for (const m of ms) push({ kind: "delete", line: m.id, base: m.rev }, deleter);
      for (const l of bs) insert(l.text, l.by);
      return;
    }
    if (!pick) conflicts.push({ line: key, base: join(base.lines.filter((_, i) => g.lo <= 2 * i + 1 && 2 * i + 1 <= g.hi))!, main: join(ms), branch: join(bs) });
    if (ms.length) after = ms.at(-1)!.id;
  };
  let r = 0;
  for (const l of branch.lines) {
    const p = branchPos.get(l.id)!;
    while (r < regions.length && regions[r]!.lo <= p) settle(regions[r++]!);
    if (r && p <= regions[r - 1]!.hi) continue;
    const b = was.get(l.id);
    if (!b) {
      const from = moveOf.get(l.id), m = from && now.get(from);
      // The branch moved a line: it carries main's edit, and a line both moved stays where main put it.
      if (from && !m && movedOnMain.has(from)) continue;
      if (m && m.text !== was.get(from)!.text) { insert(m.text, m.by); continue; }
      const same = twin(l.text);
      if (same) { after = same; continue; }
      // Main added this very line somewhere else: landing it too would double it.
      if (mainAdded.has(l.text) && /[A-Za-z]{2}/.test(l.text) && l.text.trim().length >= 8 && resolve[l.id] !== "branch") {
        if (!resolve[l.id]) conflicts.push({ line: l.id, base: "", main: l.text, branch: l.text, doubled: true });
        continue;
      }
      insert(l.text, l.by);
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
    // Lines the branch added under a line main moved go under it where it is now.
    if (m) after = m.id;
  }
  while (r < regions.length) settle(regions[r++]!);
  const kept = new Set(branch.lines.map((l) => l.id));
  for (const b of base.lines) {
    if (kept.has(b.id)) continue;
    // Moved on both sides: main's copy stays.
    const m = now.get(b.id) ?? (movedOnBranch.has(b.id) ? undefined : movedOnMain.get(b.id));
    if (!m || inRegion(mainPos.get(m.id)!)) continue;
    const pick = m.text === b.text || movedOnBranch.has(b.id) ? "branch" : resolve[b.id];
    if (!pick) conflicts.push({ line: b.id, base: b.text, main: m.text, branch: null });
    else if (pick === "branch") push({ kind: "delete", line: m.id, base: m.rev }, deleter);
  }
  if (kind === "keyed") twiceKeyed(main, branch, ops, by, conflicts, resolve, deleter, path);
  return { ops, by, conflicts };
}

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
function twiceKeyed(main: Doc, branch: Doc, ops: Op[], by: string[], conflicts: Conflict[], resolve: Record<string, "branch" | "main">, deleter: string, path: string) {
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
 * Lines `side` moved since `base`: each base line it deleted whose exact text
 * it inserted elsewhere, by base id. An unambiguous text (one deleted, one
 * added, not blank) is a move on its own; the deleted lines around a move
 * that match the added lines around it, blank or repeated (`}`), moved with it.
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
  // Grow each move into the block it came with, a line at a time either way.
  const bi = new Map(base.lines.map((l, i) => [l.id, i])), si = new Map(side.lines.map((l, i) => [l.id, i]));
  const into = new Set([...out.values()].map((l) => l.id)), todo = [...out];
  while (todo.length) {
    const [id, to] = todo.pop()!;
    for (const d of [-1, 1]) {
      const b = base.lines[bi.get(id)! + d], s = side.lines[si.get(to.id)! + d];
      if (!b || !s || has.has(b.id) || out.has(b.id) || was.has(s.id) || into.has(s.id) || b.text !== s.text) continue;
      out.set(b.id, s); into.add(s.id); todo.push([b.id, s]);
    }
  }
  return out;
}

// Positions against base: base line i at 2i + 1, the gap after it at 2i + 2, the top at 0.
interface Region { lo: number; hi: number }
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

const words = (s: string) => s.match(/\s+|\w+|[^\s\w]/g) ?? [];

/**
 * Two edits of one line, merged word by word: each side's changes to `base`
 * as spans of words, applied together. Null when the spans overlap or touch
 * (unless both made the very same change), or when a word one side replaced
 * is one the other side adds (a rename on one side, a new use of the old
 * name on the other): that's a real conflict.
 */
export function mergeWords(base: string, a: string, b: string): string | null {
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
  const sa = spans(words(a)), sb = spans(words(b));
  const named = (ws: string[]) => new Set(ws.filter((w) => /\w/.test(w)));
  const gone = (ss: typeof sa) => named(ss.flatMap((s) => o.slice(s.from, s.to))), added = (ss: typeof sa) => named(ss.flatMap((s) => s.add));
  const clash = (x: Set<string>, y: Set<string>) => [...x].some((w) => y.has(w));
  if (clash(gone(sa), added(sb)) || clash(gone(sb), added(sa))) return null;
  const all = [...sa, ...sb].sort((p, q) => p.from - q.from || p.to - q.to);
  let out = "", i = 0, last: (typeof all)[number] | null = null;
  for (const s of all) {
    if (last && s.from <= last.to) {
      if (s.from === last.from && s.to === last.to && s.add.join("") === last.add.join("")) continue;
      return null;
    }
    out += o.slice(i, s.from).join("") + s.add.join("");
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
