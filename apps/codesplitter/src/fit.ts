// Rusty Buns fit: could this repo ship as a desktop binary, a Worker and a
// server with `rustybuns init`? Reads the top level, package.json and any
// vite config, and lets the CLI's own detector decide. A monorepo root also
// lists its workspaces, each with a verdict of its own; ?dir= checks one.
// The verdict is kept in D1 by the commit it was read at, so a visit only
// reads the files again once main has moved.
//
//   GET /api/repos/:o/:r/fit[?dir=apps/web]
//     {verdict, stack, label, typescript, reasons, issue?, dir?, workspaces?: [{dir, name, verdict, stack, label}]}

import { fit, type Fit } from "@rustybuns/cli/fit";
import type { Doc } from "./lines.ts";
import type { Env } from "./env.ts";
import { actingAs } from "./identity.ts";
import { json } from "./env.ts";

type Self = (r: Request) => Promise<Response>;
type Entry = { path: string; type: string };

/** How many workspaces a monorepo root checks before it stops: each one costs a few reads. */
const MAX_WORKSPACES = 24;

// Bumped when the detector's verdicts change, so cached ones are read again.
const FIT_V = "v1:";

/** Workspace globs from package.json's `workspaces` (array or {packages}) or pnpm-workspace.yaml's `packages:`. */
export function workspaceGlobs(pkg: Record<string, any> | null, pnpmYaml: string | null): string[] {
  const out: string[] = [];
  const ws = pkg?.workspaces;
  for (const g of Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : []) if (typeof g === "string") out.push(g);
  if (pnpmYaml) {
    let inPackages = false;
    for (const line of pnpmYaml.split("\n")) {
      if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
      if (inPackages && /^\S/.test(line)) inPackages = false;
      const m = inPackages && line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*(#.*)?$/);
      if (m) out.push(m[1]!);
    }
  }
  return [...new Set(out.filter((g) => !g.startsWith("!")).map((g) => g.replace(/^\.\//, "").replace(/\/+$/, "")).filter(Boolean))];
}

/** Each glob one level deep: `apps/*` (or `apps/**`) is every folder in apps/, anything else is a folder itself. At most MAX_WORKSPACES. */
export async function workspaceDirs(globs: string[], list: (dir: string) => Promise<Entry[] | null>): Promise<string[]> {
  const dirs: string[] = [];
  for (const g of globs) {
    const star = g.match(/^(.*?)\/\*{1,2}$/);
    if (!star) { dirs.push(g); continue; }
    if (star[1]!.includes("*")) continue;
    for (const e of (await list(star[1]!)) ?? []) if (e.type === "dir") dirs.push(e.path);
  }
  return [...new Set(dirs)].sort().slice(0, MAX_WORKSPACES);
}

export async function repoFit(env: Env, self: Self, origin: string, owner: string, repo: string, user: string | null, dir = ""): Promise<Response> {
  dir = dir.replace(/^\/+|\/+$/g, "");
  if (dir.split("/").some((s) => s === ".." || s === ".")) return json({ error: "dir: a folder in the repo" }, 400);
  const get = (path: string) => { const r = new Request(origin + `/api/repos/${owner}/${repo}` + path); if (user) actingAs.set(r, user); return self(r); };
  const tree = async (d: string) => {
    const r = await get(`/tree?path=${encodeURIComponent(d)}`);
    return r.status === 200 ? ((await r.json()) as { commit: { hash: string } | null; entries: Entry[] }) : null;
  };
  const list = async (d: string) => (await tree(d))?.entries ?? null;
  const read = async (path: string) => {
    const r = await get(`/do/file?path=${encodeURIComponent(path)}`);
    return r.ok ? ((await r.json()) as Doc).lines.map((l) => l.text).join("\n") : null;
  };
  const join = (d: string, name: string) => d ? `${d}/${name}` : name;

  /** The fit of one folder, with paths relative to it, and its package.json for the caller. */
  const fitAt = async (d: string, top: Entry[]): Promise<{ f: Fit; pkg: Record<string, any> | null; files: string[] }> => {
    const rel = (p: string) => d ? p.slice(d.length + 1) : p;
    const files = top.map((e) => rel(e.path));
    // One level down is enough to spot TypeScript in the usual places.
    for (const e of top.filter((e) => e.type === "dir" && ["src", "app", "lib", "server"].includes(rel(e.path)))) files.push(...((await list(e.path)) ?? []).map((x) => rel(x.path)));
    let pkg: Record<string, any> | null = null;
    if (files.includes("package.json")) {
      try { pkg = JSON.parse((await read(join(d, "package.json"))) ?? "null"); }
      catch { return { f: { verdict: "poor", stack: "unknown", label: "package.json", typescript: false, reasons: ["package.json isn't valid JSON."] }, pkg: null, files }; }
    }
    const vitePath = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"].find((f) => files.includes(f));
    const viteConfig = vitePath ? await read(join(d, vitePath)) : null;
    return { f: fit({ pkg, files, viteConfig }), pkg, files };
  };

  const t = await tree(dir);
  if (dir && !t?.entries.length) return json({ error: `no folder ${dir} in this repo` }, 404);
  if (!t) return json({ error: "this repo's files aren't ready yet" }, 202);
  // A repo with no commit yet isn't cached; its files are all still in flight.
  const key = t.commit && FIT_V + t.commit.hash;
  if (key) {
    const hit = await env.DB.prepare("SELECT data FROM fit_cache WHERE owner = ? AND repo = ? AND dir = ? AND commit_hash = ?").bind(owner, repo, dir, key).first();
    if (hit) return json(JSON.parse(hit.data as string));
  }
  const verdict = await judge(t.entries);
  if (key) await env.DB.prepare("INSERT OR REPLACE INTO fit_cache (owner, repo, dir, commit_hash, data) VALUES (?, ?, ?, ?, ?)").bind(owner, repo, dir, key, JSON.stringify(verdict)).run();
  return json(verdict);

  async function judge(top: Entry[]) {
    const { f, pkg, files } = await fitAt(dir, top);
    if (dir) return { ...f, dir };

    const globs = workspaceGlobs(pkg, files.includes("pnpm-workspace.yaml") ? await read("pnpm-workspace.yaml") : null);
    if (!globs.length) return f;

    const workspaces = [];
    for (const d of await workspaceDirs(globs, list)) {
      const entries = await list(d);
      if (!entries?.some((e) => e.type === "file" && e.path === join(d, "package.json"))) continue;
      const w = await fitAt(d, entries);
      workspaces.push({ dir: d, name: typeof w.pkg?.name === "string" ? w.pkg.name : d.split("/").pop()!, verdict: w.f.verdict, stack: w.f.stack, label: w.f.label });
    }
    return { ...f, workspaces };
  }
}
