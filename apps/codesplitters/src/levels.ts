// Levels: famous open-source repos, imported into Artifacts as shallow,
// read-only digs. Browse any of them; fork one into your own excavation to
// edit it. Ordered roughly by how deep the dig goes.

import { listDir, readText } from "./archive.ts";
import { code, json, NAME, type Env } from "./env.ts";

export interface Level { n: number; slug: string; title: string; repo: string; branch: string; blurb: string }

export const LEVELS: Level[] = [
  { n: 1, slug: "alchemy", title: "Alchemy", repo: "alchemy-run/alchemy", branch: "main", blurb: "Infrastructure as TypeScript. The tool that deploys this app." },
  { n: 2, slug: "t3code", title: "T3 Code", repo: "pingdotgg/t3code", branch: "main", blurb: "A desktop home for coding agents." },
  { n: 3, slug: "tanstack", title: "TanStack Router & Start", repo: "TanStack/router", branch: "main", blurb: "Type-safe routing, and the full-stack framework built on it." },
  { n: 4, slug: "effect", title: "Effect", repo: "Effect-TS/effect", branch: "main", blurb: "Typed effects, errors and concurrency for TypeScript." },
  { n: 5, slug: "react", title: "React", repo: "react/react", branch: "main", blurb: "The library for web and native user interfaces." },
  { n: 6, slug: "nextjs", title: "Next.js", repo: "vercel/next.js", branch: "canary", blurb: "The React framework, all of it." },
  { n: 7, slug: "bun", title: "Bun", repo: "oven-sh/bun", branch: "main", blurb: "Runtime, bundler, test runner and package manager in one, in Zig." },
];

const artifactName = (slug: string) => `level-${slug}`;

/** Each level with where its import stands. Importing ones are re-checked. */
async function states(env: Env) {
  const { results } = await env.DB.prepare("SELECT * FROM levels").all();
  const rows = new Map<string, any>(results.map((r: any) => [r.slug, r]));
  return Promise.all(LEVELS.map(async (l) => {
    const row = rows.get(l.slug);
    if (row?.status === "importing" && env.ARTIFACTS) {
      try {
        const handle = await env.ARTIFACTS.get(artifactName(l.slug));
        const [tip] = await handle.log({ ref: l.branch, limit: 1 });
        await env.DB.prepare("UPDATE levels SET status = 'ready', commit_hash = ?, error = NULL WHERE slug = ?").bind(tip?.hash ?? null, l.slug).run();
        Object.assign(row, { status: "ready", commit_hash: tip?.hash ?? null, error: null });
      } catch (e) {
        if (code(e) !== "IMPORT_IN_PROGRESS") {
          await env.DB.prepare("UPDATE levels SET status = 'failed', error = ? WHERE slug = ?").bind(String((e as Error).message ?? e), l.slug).run();
          Object.assign(row, { status: "failed", error: String((e as Error).message ?? e) });
        }
      }
    }
    return { ...l, status: row?.status ?? "buried", error: row?.error ?? null, commit: row?.commit_hash ?? null };
  }));
}

async function ready(env: Env, slug: string) {
  const level = LEVELS.find((l) => l.slug === slug);
  if (!level || !env.ARTIFACTS) return null;
  const row = await env.DB.prepare("SELECT status FROM levels WHERE slug = ?").bind(slug).first();
  if (row?.status !== "ready") return null;
  return { level, handle: await env.ARTIFACTS.get(artifactName(slug)) };
}

/** /api/levels... ; `user` is the caller's handle, `admin` whether they may import. */
export async function levelRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null, admin: boolean): Promise<Response | null> {
  if (p[1] !== "levels") return null;
  if (!p[2]) return json(await states(env));
  const slug = p[2];
  const level = LEVELS.find((l) => l.slug === slug);
  if (!level) return json({ error: "no such level" }, 404);

  // POST /api/levels/:slug/import  (admins): a shallow, read-only copy of the default branch
  if (p[3] === "import" && req.method === "POST") {
    if (!admin) return json({ error: "admins only" }, 403);
    if (!env.ARTIFACTS) return json({ error: "no Artifacts binding" }, 501);
    try {
      await env.ARTIFACTS.import({
        source: { url: `https://github.com/${level.repo}.git`, branch: level.branch, depth: 1 },
        target: { name: artifactName(slug), opts: { readOnly: true, description: `${level.title} (${level.repo}), a codeSplitters level` } },
      });
    } catch (e) {
      if (code(e) !== "ALREADY_EXISTS") return json({ error: String((e as Error).message ?? e) }, 502);
    }
    await env.DB.prepare("INSERT INTO levels (slug, status, imported_at) VALUES (?, 'importing', ?) ON CONFLICT(slug) DO UPDATE SET status = 'importing', error = NULL")
      .bind(slug, Date.now()).run();
    return json({ slug, status: "importing" }, 202);
  }

  const r = await ready(env, slug);
  if (!r) return json({ error: "this level hasn't been excavated yet" }, 409);

  // GET /api/levels/:slug/tree?path=dir
  if (p[3] === "tree") {
    const listing = await listDir(env, r.handle, level.branch, url.searchParams.get("path") ?? "");
    if (!listing.entries) return json({ error: "no such folder" }, 404);
    return json({ ...listing, commit: listing.commit && { hash: listing.commit.hash, message: listing.commit.message.split("\n")[0] } });
  }
  // GET /api/levels/:slug/file?path=  read-only; fork the level to edit it
  if (p[3] === "file") {
    const got = await readText(r.handle, level.branch, url.searchParams.get("path") ?? "");
    return "error" in got ? json({ error: got.error }, got.status) : json(got);
  }
  // POST /api/levels/:slug/fork {name}  -> your own excavation, writable, with the level's history
  if (p[3] === "fork" && req.method === "POST") {
    if (!user) return json({ error: "sign in first" }, 401);
    const { name = slug } = (await req.json().catch(() => ({}))) as { name?: string };
    if (!NAME.test(name)) return json({ error: "bad repo name" }, 400);
    if (await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(user, name).first()) return json({ error: "you already have a repo with that name" }, 409);
    const art = await r.handle.fork(`${user}--${name}`, { description: `${user}'s dig of ${level.title}`, defaultBranchOnly: true });
    await env.DB.prepare("INSERT INTO repos (owner, name, visibility, created_at, artifact, artifact_remote, branch, level) VALUES (?, ?, 'public', ?, ?, ?, ?, ?)")
      .bind(user, name, Date.now(), art.name, art.remote, art.defaultBranch ?? level.branch, slug).run();
    return json({ owner: user, name }, 201);
  }
  return json({ error: "not found" }, 404);
}

