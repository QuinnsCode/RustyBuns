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
// Then the app's own pre-steps that an inferred `vite build` skips: a `predev` made only of
// script runs in workspace packages (`pnpm --filter @acme/site generate`: files the app imports
// from a sibling that ships source), and its `prebuild` (#5766).

type Member = { name: string; dir: string; pkg: any };

/**
 * The shell steps that build `dir`'s unbuilt workspace dependencies, in dependency order, then its
 * own generate steps. `build` is the build they go in front of: a `<pm> run build` runs `prebuild` itself.
 */
export function workspacePrebuild(dir: string, build = ""): string[] {
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
  if (!self) return out;
  if (self.name) seen.add(self.name);
  visit(self);
  for (const [name, script] of filteredRuns(self.scripts?.predev, members)) {
    const step = `(cd ${sh(members.get(name)!.dir)} && ${pm} run ${script})`;
    if (!out.includes(step)) out.push(step);
  }
  if (self.scripts?.prebuild && !new RegExp(`^${pm} run build\\b`).test(build.trim())) out.push(`(cd ${sh(resolve(dir))} && ${pm} run prebuild)`);
  return out;
}

/**
 * A script made only of runs in workspace members, as [member, script] pairs; [] if any part is something else.
 *   "pnpm --filter @acme/site generate && yarn workspace ui run icons" -> [["@acme/site", "generate"], ["ui", "icons"]]
 */
export function filteredRuns(script: unknown, members: Map<string, unknown>): [string, string][] {
  if (typeof script !== "string" || !script.trim()) return [];
  const out: [string, string][] = [];
  for (const part of script.split("&&")) {
    const words = part.trim().split(/\s+/).map((w) => w.replace(/^(['"])(.*)\1$/, "$2"));
    const [pm, ...rest] = words;
    if (!pm || !["pnpm", "npm", "yarn", "bun"].includes(pm)) return [];
    let name = "";
    const args: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const w = rest[i]!;
      const eq = /^(--filter|--workspace)=(.+)$/.exec(w);
      if (eq) name = eq[2]!;
      else if (["--filter", "-F", "--workspace", "-w"].includes(w)) name = rest[++i] ?? "";
      else if (pm === "yarn" && w === "workspace" && !name) name = rest[++i] ?? "";
      else if (w !== "run") args.push(w);
    }
    if (!members.has(name) || args.length !== 1 || args[0]!.startsWith("-")) return [];
    out.push([name, args[0]!]);
  }
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
