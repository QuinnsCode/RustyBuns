// Dependency fights (#1477): find a repo's dependency files, ask what a bump crosses, prove the merge builds.
// Imports only manifest.ts, so the registry, OSV and the sandbox come in as arguments and tests stay offline.
//
//   detectDependencyFiles   which paths are manifests (npm, Cargo, pyproject, go.mod, Gemfile) and which lock them
//   settleDeps              a package.json both sides bumped: the higher version when the docs call it safe, else a card
//   mergeTable              Cargo.toml / pyproject.toml / go.mod dependency tables, merged by key like manifest.ts
//   proveMerge              install and build the merged tree in a sandbox that is torn down whatever happens
import { floor, higher, mergeManifest } from "./manifest.ts";

export type Ecosystem = "npm" | "cargo" | "python" | "go" | "ruby";
export interface DepFile { path: string; eco: Ecosystem; kind: "manifest" | "lock"; /** The manifest a lockfile follows. */ follows?: string; /** A workspace member of the root manifest at this path. */ member?: string }

const FILES: [RegExp, Ecosystem, "manifest" | "lock"][] = [
  [/(^|\/)package\.json$/, "npm", "manifest"],
  [/(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/, "npm", "lock"],
  [/(^|\/)Cargo\.toml$/, "cargo", "manifest"], [/(^|\/)Cargo\.lock$/, "cargo", "lock"],
  [/(^|\/)(pyproject\.toml|requirements[\w.-]*\.txt)$/, "python", "manifest"], [/(^|\/)(poetry\.lock|uv\.lock|Pipfile\.lock)$/, "python", "lock"],
  [/(^|\/)go\.mod$/, "go", "manifest"], [/(^|\/)go\.sum$/, "go", "lock"],
  [/(^|\/)Gemfile$/, "ruby", "manifest"], [/(^|\/)Gemfile\.lock$/, "ruby", "lock"],
];
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const globRe = (g: string) => new RegExp("^" + g.replace(/^\.\//, "").replace(/\/$/, "").split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+") + "$");

/**
 * The dependency files among a repo's paths. A lockfile follows the manifest in its directory (or the nearest one
 * above); `rootManifest` (the root package.json's text) marks which package.json files are its workspace members.
 */
export function detectDependencyFiles(paths: string[], rootManifest?: string): DepFile[] {
  const out: DepFile[] = [];
  for (const path of paths) {
    if (/(^|\/)node_modules\//.test(path) || /(^|\/)(vendor|target)\//.test(path)) continue;
    const hit = FILES.find(([re]) => re.test(path));
    if (hit) out.push({ path, eco: hit[1], kind: hit[2] });
  }
  const manifests = out.filter((f) => f.kind === "manifest");
  for (const f of out.filter((x) => x.kind === "lock")) {
    let d = dirOf(f.path);
    for (;;) {
      const m = manifests.find((x) => x.eco === f.eco && dirOf(x.path) === d);
      if (m) { f.follows = m.path; break; }
      if (!d) break;
      d = dirOf(d);
    }
  }
  let globs: string[] = [];
  try {
    const w = JSON.parse(rootManifest ?? "{}").workspaces;
    globs = Array.isArray(w) ? w : Array.isArray(w?.packages) ? w.packages : [];
  } catch {}
  const res = globs.filter((g) => !g.startsWith("!")).map(globRe);
  for (const f of manifests) if (f.eco === "npm" && f.path !== "package.json" && res.some((re) => re.test(dirOf(f.path)))) f.member = "package.json";
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** What a bump crosses, from the dependency's own changelog, release notes and advisories. */
export interface Finding { breaking: string[]; fixes: string[]; note?: string }
/** Looks a bump up. Real lookups bill per call (registry, OSV), so `settleDeps` counts them against a Budget. */
export type Docs = (eco: Ecosystem, name: string, from: string, to: string) => Promise<Finding | null>;

/** A cap on lookups and sandbox runs, per pass and per repo. */
export class Budget {
  used = 0;
  constructor(readonly cap: number) {}
  take(): boolean { if (this.used >= this.cap) return false; this.used++; return true; }
}

/** A card for the person: what the merge could not settle, and why. */
export interface DepCard { name: string; from: string; to: string; why: string }
export interface Settled { text: string | null; cards: DepCard[]; took: string[] }

const major = (v: string) => floor(v)?.[0] ?? null;

/** The dependencies both branches changed (base had them): name, main's range, branch's range. */
export function bothBumped(base: string, main: string, branch: string): { name: string; section: string; main: string; branch: string }[] {
  const out: { name: string; section: string; main: string; branch: string }[] = [];
  try {
    const [b, m, br] = [base, main, branch].map((t) => JSON.parse(t));
    for (const s of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, mv] of Object.entries<any>(m?.[s] ?? {})) {
        const bv = b?.[s]?.[name], brv = br?.[s]?.[name];
        if (typeof bv === "string" && typeof brv === "string" && mv !== bv && brv !== bv && mv !== brv) out.push({ name, section: s, main: mv, branch: brv });
      }
    }
  } catch {}
  return out;
}

/**
 * A package.json both sides changed. manifest.ts takes the higher version of a dependency both bumped; this asks the
 * dependency's docs first when that bump crosses a major. The higher is taken when the docs show nothing broke (or
 * a fix for a known advisory is the reason), otherwise the card keeps both sides and says what the docs found.
 * With no docs, or a spent budget, a crossing is a card rather than a guess.
 */
export async function settleDeps(base: string, main: string, branch: string, docs: Docs | null, budget: Budget, usage: (name: string) => string | null = () => null): Promise<Settled> {
  const cards: DepCard[] = [], took: string[] = [];
  for (const d of bothBumped(base, main, branch)) {
    const hi = higher(d.main, d.branch);
    if (hi === null) continue; // not comparable: manifest.ts already returns null for it
    const lo = hi === d.main ? d.branch : d.main;
    const [a, b] = [major(lo), major(hi)];
    if (a === null || b === null || a === b) { took.push(`${d.name} ${hi}`); continue; }
    const f = docs && budget.take() ? await docs("npm", d.name, lo, hi).catch(() => null) : null;
    if (f && !f.breaking.length) { took.push(`${d.name} ${hi}`); continue; }
    const where = usage(d.name);
    const why = f ? `${d.name} ${lo} to ${hi} ${f.breaking.join("; ")}${where ? `; branch uses it at ${where}` : ""}`
      : `${d.name} ${lo} to ${hi} crosses a major and the docs were not read${budget.used >= budget.cap ? " (lookup budget spent)" : ""}`;
    cards.push({ name: d.name, from: lo, to: hi, why });
  }
  if (cards.length) return { text: null, cards, took };
  return { text: mergeManifest(base, main, branch), cards, took };
}

/** A real lookup: the npm packument's deprecation and README notes for the target version, plus OSV's fixed advisories. */
export function npmDocs(get: typeof fetch = fetch, advisories?: (name: string, version: string) => Promise<string[]>): Docs {
  return async (eco, name, from, to) => {
    if (eco !== "npm") return null;
    const res = await get(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
    if (!res.ok) return null;
    const p: any = await res.json();
    const want = to.replace(/^[\^~>=<\s]*v?/, "");
    const v = p.versions?.[want] ?? p.versions?.[p["dist-tags"]?.latest];
    const breaking: string[] = [];
    if (v?.deprecated) breaking.push(`is deprecated: ${String(v.deprecated).slice(0, 120)}`);
    const sec = String(p.readme ?? "").split(/^#{1,3}\s/m).find((s) => s.includes(want) && /breaking|removed|renamed/i.test(s));
    for (const line of (sec ?? "").split("\n")) if (/breaking|removed|renamed/i.test(line)) breaking.push(line.replace(/^[-*\s]+/, "").slice(0, 120));
    return { breaking: breaking.slice(0, 3), fixes: (await advisories?.(name, from).catch(() => [])) ?? [] };
  };
}

// ---- Cargo.toml, pyproject.toml, go.mod: tables merged by key ----

type Table = { section: string; keys: string[]; vals: Map<string, string> };
function parseTables(text: string, go: boolean): Table[] {
  const out: Table[] = [];
  let cur: Table | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (go) {
      if (/^require\s*\($/.test(line)) { cur = { section: "require", keys: [], vals: new Map() }; out.push(cur); continue; }
      if (line === ")") { cur = null; continue; }
      const m = line.match(/^(?:require\s+)?([^\s/][^\s]*)\s+(v[\w.+-]+)(\s*\/\/.*)?$/);
      if (m && cur) { cur.keys.push(m[1]!); cur.vals.set(m[1]!, m[2]!); }
    } else {
      const h = line.match(/^\[([^\]]+)\]$/);
      if (h) { cur = /dependencies$/.test(h[1]!) ? { section: h[1]!, keys: [], vals: new Map() } : null; if (cur) out.push(cur); continue; }
      const kv = line.match(/^([\w.-]+)\s*=\s*(?:"([^"]*)"|\{[^}]*\bversion\s*=\s*"([^"]*)")/);
      if (kv && cur) { cur.keys.push(kv[1]!); cur.vals.set(kv[1]!, kv[2] ?? kv[3]!); }
    }
  }
  return out;
}

/** Whether the path is a dependency table this file merges (go.mod, Cargo.toml, pyproject.toml). */
export const isTable = (path: string) => /(^|\/)(go\.mod|Cargo\.toml|pyproject\.toml)$/.test(path);

/**
 * A go.mod, Cargo.toml or pyproject.toml both sides changed, merged per dependency like manifest.ts: a key one side
 * changed takes that side, the higher version wins when both bumped, new keys of both land. Only versions change, and
 * only inside the dependency tables; any other difference between main and branch (or a version that can't be
 * compared) returns null and the lines merge asks. Text is main's, edited in place.
 */
export function mergeTable(path: string, base: string, main: string, branch: string): string | null {
  const go = /go\.mod$/.test(path);
  const [tb, tm, tr] = [base, main, branch].map((t) => parseTables(t, go));
  const val = (ts: Table[], s: string, k: string) => ts.find((t) => t.section === s)?.vals.get(k);
  const swaps = new Map<string, string>(), adds: [string, string, string][] = [];
  for (const t of tr) for (const k of t.keys) {
    const [b, m, r] = [val(tb, t.section, k), val(tm, t.section, k), t.vals.get(k)!];
    if (m === r || b === r) continue; // main has it or only main changed
    if (m === undefined && b === undefined) { adds.push([t.section, k, r]); continue; }
    if (m === undefined || b === undefined) return null; // main removed it, or both added different
    if (b === m) { swaps.set(`${t.section}\0${k}`, r); continue; }
    const h = higher(m, r); // both bumped
    if (h === null) return null;
    if (h === r) swaps.set(`${t.section}\0${k}`, r);
  }
  // Anything outside the dependency tables must already agree, or this is not just a version merge.
  const strip = (t: string, ts: Table[]) => t.split("\n").filter((l) => !ts.some((x) => x.keys.some((k) => l.includes(k)))).join("\n");
  if (strip(main, tm) !== strip(branch, tr) && strip(base, tb) !== strip(branch, tr) && strip(base, tb) !== strip(main, tm)) return null;
  const lines = main.split("\n");
  let section = "";
  const done: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!, h = l.trim().match(/^\[([^\]]+)\]$/);
    if (h) section = h[1]!; else if (go && /^require\s*\($/.test(l.trim())) section = "require";
    const k = l.trim().match(go ? /^(?:require\s+)?([^\s/][^\s]*)\s+v/ : /^([\w.-]+)\s*=/)?.[1];
    const to = k && swaps.get(`${section}\0${k}`);
    if (to) { const from = tm.find((t) => t.section === section)!.vals.get(k)!; lines[i] = l.replace(from, to); done.push(k); }
  }
  for (const [s, k, v] of adds) {
    let at = -1, cur = "";
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i]!.trim().match(/^\[([^\]]+)\]$/);
      if (h) cur = h[1]!; else if (go && /^require\s*\($/.test(lines[i]!.trim())) cur = "require";
      if (cur === s && lines[i]!.trim() && !h && lines[i]!.trim() !== ")" && !/^require\s*\($/.test(lines[i]!.trim())) at = i;
    }
    if (at < 0) return null;
    lines.splice(at + 1, 0, go ? `\t${k} ${v}` : `${k} = "${v}"`);
  }
  return lines.join("\n");
}

// ---- the sandbox proof ----

/** A throwaway install-and-build environment: `run` installs and builds `files`; `destroy` always runs after. */
export interface Proof { run(files: Record<string, string>): Promise<{ ok: boolean; out: string }>; destroy(): Promise<void> }
export type Proved = { ok: true } | { ok: false; card: DepCard } | { ok: null; skipped: string };

/**
 * Install and build the merged tree before it lands. The sandbox is destroyed even when the build throws, a build that
 * fails comes back as a card carrying the log's tail, and a spent budget skips the proof instead of billing for it.
 */
export async function proveMerge(open: () => Proof, files: Record<string, string>, budget: Budget, name = "merged tree"): Promise<Proved> {
  if (!budget.take()) return { ok: null, skipped: "sandbox budget spent" };
  const p = open();
  try {
    const r = await p.run(files);
    return r.ok ? { ok: true } : { ok: false, card: { name, from: "", to: "", why: `install and build failed:\n${r.out.split("\n").slice(-30).join("\n")}` } };
  } catch (e) {
    return { ok: false, card: { name, from: "", to: "", why: `sandbox failed: ${(e as Error).message}` } };
  } finally { await p.destroy().catch(() => {}); }
}
