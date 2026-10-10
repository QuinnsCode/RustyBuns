// Rusty Buns fit: could this repo ship as a desktop binary, a Worker and a
// server with `rustybuns init`? Reads the top level, package.json and any
// vite config, and lets the CLI's own detector decide. The verdict is kept in
// D1 by the commit it was read at, so a visit only reads the files again
// once main has moved.
//
//   GET /api/repos/:o/:r/fit   {verdict, stack, label, typescript, reasons, issue?}

import { fit, type Fit } from "@rustybuns/cli/fit";
import type { Doc } from "./lines.ts";
import type { Env } from "./env.ts";
import { actingAs } from "./identity.ts";
import { json } from "./env.ts";

type Self = (r: Request) => Promise<Response>;

// Bumped when the detector's verdicts change, so cached ones are read again.
const FIT_V = "v1:";

export async function repoFit(env: Env, self: Self, origin: string, owner: string, repo: string, user: string | null): Promise<Response> {
  const get = (path: string) => { const r = new Request(origin + `/api/repos/${owner}/${repo}` + path); if (user) actingAs.set(r, user); return self(r); };
  const list = async (dir: string) => {
    const r = await get(`/tree?path=${encodeURIComponent(dir)}`);
    return r.status === 200 ? ((await r.json()) as { commit: { hash: string } | null; entries: { path: string; type: string }[] }) : null;
  };
  const read = async (path: string) => {
    const r = await get(`/do/file?path=${encodeURIComponent(path)}`);
    return r.ok ? ((await r.json()) as Doc).lines.map((l) => l.text).join("\n") : null;
  };

  const top = await list("");
  if (!top) return json({ error: "this repo's files aren't ready yet" }, 202);
  // A repo with no commit yet isn't cached; its files are all still in flight.
  const key = top.commit && FIT_V + top.commit.hash;
  if (key) {
    const hit = await env.DB.prepare("SELECT data FROM fit_cache WHERE owner = ? AND repo = ? AND commit_hash = ?").bind(owner, repo, key).first();
    if (hit) return json(JSON.parse(hit.data));
  }
  const verdict = await judge(top.entries, list, read);
  if (key) await env.DB.prepare("INSERT OR REPLACE INTO fit_cache (owner, repo, commit_hash, data) VALUES (?, ?, ?, ?)").bind(owner, repo, key, JSON.stringify(verdict)).run();
  return json(verdict);
}

async function judge(
  top: { path: string; type: string }[],
  list: (dir: string) => Promise<{ entries: { path: string }[] } | null>,
  read: (path: string) => Promise<string | null>,
): Promise<Fit> {
  const files = top.map((e) => e.path);
  // One level down is enough to spot TypeScript in the usual places.
  for (const d of top.filter((e) => e.type === "dir" && ["src", "app", "lib", "server"].includes(e.path))) files.push(...((await list(d.path))?.entries ?? []).map((e) => e.path));

  let pkg: Record<string, any> | null = null;
  if (files.includes("package.json")) {
    try { pkg = JSON.parse((await read("package.json")) ?? "null"); }
    catch { return { verdict: "poor", stack: "unknown", label: "package.json", typescript: false, reasons: ["package.json isn't valid JSON."] }; }
  }
  const vitePath = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"].find((f) => files.includes(f));
  const viteConfig = vitePath ? await read(vitePath) : null;
  return fit({ pkg, files, viteConfig });
}
