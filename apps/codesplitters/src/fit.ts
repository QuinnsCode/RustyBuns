// Rusty Buns fit: could this repo ship as a desktop binary, a Worker and a
// server with `rustybuns init`? Reads the top level, package.json and any
// vite config, and lets the CLI's own detector decide.
//
//   GET /api/repos/:o/:r/fit   {verdict, stack, label, typescript, reasons, issue?}

import { fit, type Fit } from "@rustybuns/cli/fit";
import type { Doc } from "./lines.ts";
import { actingAs } from "./identity.ts";
import { json } from "./env.ts";

type Self = (r: Request) => Promise<Response>;

export async function repoFit(self: Self, origin: string, owner: string, repo: string, user: string | null): Promise<Response> {
  const get = (path: string) => { const r = new Request(origin + `/api/repos/${owner}/${repo}` + path); if (user) actingAs.set(r, user); return self(r); };
  const list = async (dir: string) => {
    const r = await get(`/tree?path=${encodeURIComponent(dir)}`);
    return r.status === 200 ? ((await r.json()) as { entries: { path: string; type: string }[] }).entries : null;
  };
  const read = async (path: string) => {
    const r = await get(`/do/file?path=${encodeURIComponent(path)}`);
    return r.ok ? ((await r.json()) as Doc).lines.map((l) => l.text).join("\n") : null;
  };

  const top = await list("");
  if (!top) return json({ error: "this repo's files aren't ready yet" }, 202);
  const files = top.map((e) => e.path);
  // One level down is enough to spot TypeScript in the usual places.
  for (const d of top.filter((e) => e.type === "dir" && ["src", "app", "lib", "server"].includes(e.path))) files.push(...((await list(d.path)) ?? []).map((e) => e.path));

  let pkg: Record<string, any> | null = null;
  if (files.includes("package.json")) {
    try { pkg = JSON.parse((await read("package.json")) ?? "null"); }
    catch { return json({ verdict: "poor", stack: "unknown", label: "package.json", typescript: false, reasons: ["package.json isn't valid JSON."] } satisfies Fit); }
  }
  const vitePath = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"].find((f) => files.includes(f));
  const viteConfig = vitePath ? await read(vitePath) : null;
  return json(fit({ pkg, files, viteConfig }));
}
