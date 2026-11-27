// The scoring behind `bun run steer` (scripts/steer.ts, #5844): BM25 over past tasks' words, a graph of which files
// change together on main, and the guesses read off them (app, files, kind of job). Pure: no git, gh or disk.
import { GENERATED } from "../packages/util/src/overlap.ts";
import { features, level, type Level } from "./task-specs.ts";

const STOP = new Set(("the and for with that this from into not are was were but has have had its it's you your our they them then " +
  "than when what which who will would can could should does did done just also only one two all any each more most some such " +
  "there their here out off one use used using make made way get got new now see may per via run runs how why where").split(" "));

/** A text's search words: lower case, no stop words, a plural's trailing s dropped. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.push(w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  }
  return out;
}

/** An inverted index: each word's postings (the tasks it is in, how often), each task's length in words. */
export interface Bm25 { words: Map<string, { doc: number[]; tf: number[] }>; len: number[]; avg: number }

/** The index over one text per past task. */
export function bm25Index(texts: string[]): Bm25 {
  const words: Bm25["words"] = new Map(), len: number[] = [];
  texts.forEach((t, d) => {
    const ws = tokens(t), m = new Map<string, number>();
    for (const w of ws) m.set(w, (m.get(w) ?? 0) + 1);
    for (const [w, n] of m) { const p = words.get(w); if (p) { p.doc.push(d); p.tf.push(n); } else words.set(w, { doc: [d], tf: [n] }); }
    len.push(ws.length);
  });
  return { words, len, avg: len.reduce((x, y) => x + y, 0) / Math.max(1, len.length) };
}

/** The past tasks nearest a query, best first (Okapi BM25, k1 1.2, b 0.75); tasks sharing no word are left out. */
export function bm25(ix: Bm25, query: string, top = 10): { doc: number; score: number }[] {
  const n = ix.len.length, score = new Map<number, number>();
  for (const w of new Set(tokens(query))) {
    const p = ix.words.get(w);
    if (!p) continue;
    const idf = Math.log(1 + (n - p.doc.length + 0.5) / (p.doc.length + 0.5));
    p.doc.forEach((d, i) => {
      const f = p.tf[i]!;
      score.set(d, (score.get(d) ?? 0) + (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * ix.len[d]!) / ix.avg)));
    });
  }
  return [...score].map(([doc, s]) => ({ doc, score: s })).sort((x, y) => y.score - x.score || x.doc - y.doc).slice(0, top);
}

/** A file worth naming as a place to start: not a lock, generated, a picture or a ratchet allowance. */
export const startable = (f: string) => !GENERATED.some((g) => g.test(f)) &&
  !/\.(png|jpe?g|webp|gif|glb|gltf|mp4|wav|mp3|ogg|ply|splat|bin)$/i.test(f) &&
  !/(^|\/)(test-times\.json|API\.lock|BREAKING\.md|[\w.-]+\.allow\.json)$/.test(f);

/** Which files change together: one squash commit on main is one PR. A commit over `max` files (a rename, a sweep)
 *  says nothing. Kept as each file's commits, so a call only pairs up the few files it asks about. */
export interface Graph { commits: string[][]; of: Map<string, number[]> }
export function coChange(commits: string[][], max = 30): Graph {
  const g: Graph = { commits: [], of: new Map() };
  for (const c of commits) {
    const fs = [...new Set(c.filter(startable))];
    if (fs.length < 2 || fs.length > max) continue;
    for (const f of fs) { const l = g.of.get(f); if (l) l.push(g.commits.length); else g.of.set(f, [g.commits.length]); }
    g.commits.push(fs);
  }
  return g;
}

/** The files that changed with `file`, and how often. */
export function partners(g: Graph, file: string): Map<string, number> {
  const row = new Map<string, number>();
  for (const i of g.of.get(file) ?? []) for (const b of g.commits[i]!) if (b !== file) row.set(b, (row.get(b) ?? 0) + 1);
  return row;
}

/** The files to start in, best first: the ones the text names, then those the nearest tasks changed (weighted by how
 *  near, a big PR's files counting less each), then their partners in the graph. `keep` drops files that no longer exist. */
export function rankFiles(named: string[], near: { files: string[]; weight: number }[], g: Graph, keep: (f: string) => boolean = () => true, top = 5): string[] {
  const score = new Map<string, number>();
  const add = (f: string, s: number) => { if (startable(f) && keep(f)) score.set(f, (score.get(f) ?? 0) + s); };
  const spread = (f: string, s: number) => {
    const row = partners(g, f);
    const total = [...row.values()].reduce((a, b) => a + b, 0);
    for (const [b, c] of row) add(b, (s * c) / total);
  };
  for (const f of named) { add(f, 100); spread(f, 10); }
  for (const n of near) {
    const fs = n.files.filter(startable), each = n.weight / Math.sqrt(Math.max(1, fs.length));
    for (const f of fs) { add(f, each); spread(f, each * 0.3); }
  }
  return [...score].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([f]) => f);
}

/** The part of the repo a file lives in: an app's folder name, a package as `packages/<name>`, else its top folder. */
export function areaOf(file: string): string {
  const p = file.split("/");
  if (p[0] === "apps" && p[1] === "frameworks" && p.length > 3) return p[2]!;
  if (p[0] === "apps" && p.length > 2) return p[1]!;
  if (p[0] === "packages" && p.length > 2) return `packages/${p[1]}`;
  return p.length > 1 ? p[0]! : "root";
}

/** The area most of a change's files sit in (pictures and generated files don't vote), or "" for none. */
export function appOf(files: string[]): string {
  const n = new Map<string, number>();
  for (const f of files.filter(startable)) n.set(areaOf(f), (n.get(areaOf(f)) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

/** The likely area for a new task: the nearest tasks vote by score, and an app the text names by its folder gets a lift. */
export function guessApp(text: string, near: { app: string; weight: number }[], apps: string[]): string {
  const v = new Map<string, number>(), lower = text.toLowerCase();
  for (const n of near) if (n.app) v.set(n.app, (v.get(n.app) ?? 0) + n.weight);
  const best = Math.max(1, ...v.values());
  for (const a of apps) if (a.length > 3 && new RegExp(`\\b${a.replace(/[-/]/g, "[-/ ]")}\\b`).test(lower)) v.set(a, (v.get(a) ?? 0) + best);
  return [...v].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

export const KINDS = ["quick fix", "feature", "climb round", "manual run", "question to the owner", "too thin: write down the decisions first"] as const;
export type Kind = (typeof KINDS)[number];

/** What kind of job a task is, read off its words and its task-specs level. */
export function kind(text: string): { kind: Kind; level: Level } {
  const f = features(text), lv = level(f);
  if (/MANUAL RUN/.test(text)) return { kind: "manual run", level: lv };
  if (/\b(hill )?climb\b|\bround \d+\b|\bbaton\b/i.test(text.slice(0, 300))) return { kind: "climb round", level: lv };
  if (lv === "vague") return { kind: "too thin: write down the decisions first", level: lv };
  const first = text.trim().split("\n")[0] ?? "";
  if (f.paths === 0 && (/\?\s*$/.test(first) || /^(should|which|what|how|can|do we|is it)\b/i.test(first))) return { kind: "question to the owner", level: lv };
  return { kind: f.words > 200 && f.bullets >= 4 ? "feature" : "quick fix", level: lv };
}
