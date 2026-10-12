import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { workspaceRoot } from "./deploy-deps.ts";
import { detectPm } from "./infer.ts";

// A monorepo app often imports workspace packages that ship as source with a build step
// ("main": "dist/index.js"). The app's own build doesn't build them, so on a fresh clone
// its vite build fails to resolve them. These are the builds to run first: every workspace
// package the app depends on (directly or through another one) whose main/module/exports
// point at a file that isn't there, deepest first.
//   apps/web -> @acme/ui ("main": "dist/index.js", no dist/) -> @acme/tokens (same)
//   -> ["(cd '<root>/packages/tokens' && pnpm run build)", "(cd '<root>/packages/ui' && pnpm run build)"]

type Member = { name: string; dir: string; pkg: any };

/** The shell steps that build `dir`'s unbuilt workspace dependencies, in dependency order. */
export function workspacePrebuild(dir: string): string[] {
  const root = workspaceRoot(dir);
  if (!root) return [];
  const members = new Map(workspaceMembers(root).map((m) => [m.name, m]));
  const pm = detectPm(root);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (pkg: any) => {
    for (const name of workspaceDeps(pkg, members)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const m = members.get(name)!;
      visit(m.pkg);
      if (m.pkg.scripts?.build && missingEntry(m)) out.push(`(cd ${sh(m.dir)} && ${pm} run build)`);
    }
  };
  const self = readJson(join(resolve(dir), "package.json"));
  if (self) { if (self.name) seen.add(self.name); visit(self); }
  return out;
}

/** The workspace's packages, from package.json `workspaces` or pnpm-workspace.yaml. */
export function workspaceMembers(root: string): Member[] {
  const ws = readJson(join(root, "package.json"))?.workspaces;
  let patterns: string[] = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : [];
  if (existsSync(join(root, "pnpm-workspace.yaml"))) {
    try { patterns = (Bun.YAML.parse(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")) as any)?.packages ?? patterns; }
    catch { /* unreadable: fall back to package.json's */ }
  }
  const include = patterns.filter((p) => !p.startsWith("!")).map((p) => p.replace(/\/$/, ""));
  const exclude = patterns.filter((p) => p.startsWith("!")).map((p) => new Bun.Glob(p.slice(1).replace(/\/$/, "")));
  const out: Member[] = [];
  const dirs = new Set<string>();
  for (const p of include) {
    for (const f of new Bun.Glob(`${p}/package.json`).scanSync({ cwd: root, onlyFiles: true })) {
      const rel = dirname(f).split("\\").join("/");
      if (rel.split("/").includes("node_modules") || exclude.some((g) => g.match(rel)) || dirs.has(rel)) continue;
      dirs.add(rel);
      const pkg = readJson(join(root, f));
      if (pkg?.name) out.push({ name: pkg.name, dir: join(root, rel), pkg });
    }
  }
  return out;
}

/** The workspace packages `pkg` depends on: `workspace:*`, or any range on a member's name (npm, yarn). */
function workspaceDeps(pkg: any, members: Map<string, Member>): string[] {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries<string>(pkg[field] ?? {})) {
      if (members.has(name) && !/^(npm|file|link|git|https?):/.test(String(spec))) names.add(name);
    }
  }
  return [...names];
}

/** A main, module or exports target that doesn't exist yet: the package needs its build. */
export function missingEntry(m: { dir: string; pkg: any }): boolean {
  const targets: string[] = [];
  for (const k of ["main", "module"]) if (typeof m.pkg[k] === "string") targets.push(m.pkg[k]);
  const walk = (e: unknown, key?: string) => {
    if (key === "types" || key === "typings") return;   // a missing .d.ts doesn't stop a bundler
    if (typeof e === "string") targets.push(e);
    else if (e && typeof e === "object") for (const [k, v] of Object.entries(e)) walk(v, k);
  };
  walk(m.pkg.exports);
  return targets.some((t) => !t.includes("*") && !existsSync(join(m.dir, t)) && !relative(m.dir, join(m.dir, t)).startsWith(".."));
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function readJson(p: string): any | null {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
