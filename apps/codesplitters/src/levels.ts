// Levels: famous open-source repos, imported into Artifacts as shallow,
// read-only digs. Browse any of them; fork one into your own excavation to
// edit it. Ordered roughly by how deep the dig goes: small, well-loved
// libraries, then Cloudflare's own open source, then the stack this app is
// built on (rwsdk, Effect, React, Alchemy, Bun), ending in the biggest digs.

import { listDir, readText } from "./archive.ts";
import { code, json, NAME, type Env } from "./env.ts";

export interface Level { n: number; slug: string; title: string; repo: string; branch: string; blurb: string }

export const LEVELS: Level[] = [
  { n: 1, slug: "mitt", title: "mitt", repo: "developit/mitt", branch: "main", blurb: "A whole event emitter in about 200 bytes. A warm-up." },
  { n: 2, slug: "clsx", title: "clsx", repo: "lukeed/clsx", branch: "master", blurb: "Class names, joined. Tiny and everywhere." },
  { n: 3, slug: "ky", title: "Ky", repo: "sindresorhus/ky", branch: "main", blurb: "fetch, with the sharp edges filed off." },
  { n: 4, slug: "zustand", title: "Zustand", repo: "pmndrs/zustand", branch: "main", blurb: "React state in a hook, and not much else." },
  { n: 5, slug: "hono", title: "Hono", repo: "honojs/hono", branch: "main", blurb: "A web framework that runs on every edge." },
  { n: 6, slug: "express", title: "Express", repo: "expressjs/express", branch: "master", blurb: "The Node web framework, the original." },
  { n: 7, slug: "preact", title: "Preact", repo: "preactjs/preact", branch: "main", blurb: "React's API in 3 KB." },
  { n: 8, slug: "actors", title: "Actors", repo: "cloudflare/actors", branch: "main", blurb: "Durable Objects, with less ceremony." },
  { n: 9, slug: "containers", title: "Containers", repo: "cloudflare/containers", branch: "main", blurb: "A container behind a Durable Object." },
  { n: 10, slug: "workers-oauth-provider", title: "Workers OAuth Provider", repo: "cloudflare/workers-oauth-provider", branch: "main", blurb: "A whole OAuth 2.1 server in one Worker." },
  { n: 11, slug: "partykit", title: "PartyKit", repo: "cloudflare/partykit", branch: "main", blurb: "Realtime rooms on Durable Objects." },
  { n: 12, slug: "capnweb", title: "Cap'n Web", repo: "cloudflare/capnweb", branch: "main", blurb: "Object-capability RPC over HTTP and WebSockets." },
  { n: 13, slug: "workers-rs", title: "workers-rs", repo: "cloudflare/workers-rs", branch: "main", blurb: "Workers in Rust, by way of Wasm." },
  { n: 14, slug: "chanfana", title: "chanfana", repo: "cloudflare/chanfana", branch: "main", blurb: "OpenAPI schemas from your Hono routes." },
  { n: 15, slug: "sandbox-sdk", title: "Sandbox SDK", repo: "cloudflare/sandbox-sdk", branch: "main", blurb: "Run untrusted code in a container. Our Cut runs on it." },
  { n: 16, slug: "pingora", title: "Pingora", repo: "cloudflare/pingora", branch: "main", blurb: "The Rust proxy that replaced nginx at Cloudflare." },
  { n: 17, slug: "agents", title: "Agents", repo: "cloudflare/agents", branch: "main", blurb: "AI agents that live in Durable Objects." },
  { n: 18, slug: "workerd", title: "workerd", repo: "cloudflare/workerd", branch: "main", blurb: "The runtime under every Worker, this one included." },
  { n: 19, slug: "rwsdk", title: "RedwoodSDK", repo: "redwoodjs/sdk", branch: "main", blurb: "Server-first React, born on Workers." },
  { n: 20, slug: "effect", title: "Effect", repo: "Effect-TS/effect-smol", branch: "main", blurb: "Effect v4, the one this app runs on." },
  { n: 21, slug: "react", title: "React", repo: "react/react", branch: "main", blurb: "The library for web and native UIs." },
  { n: 22, slug: "alchemy", title: "Alchemy", repo: "alchemy-run/alchemy", branch: "main", blurb: "Infrastructure as Effects. It deploys this site." },
  { n: 23, slug: "bun", title: "Bun", repo: "oven-sh/bun", branch: "main", blurb: "The runtime, bundler and test runner. The boss level." },
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
  // POST /api/levels/:slug/fork {name}  dig it up: your own fork, writable, with the level's history
  if (p[3] === "fork" && req.method === "POST") {
    if (!user) return json({ error: "sign in first" }, 401);
    const { name = slug } = (await req.json().catch(() => ({}))) as { name?: string };
    if (!NAME.test(name)) return json({ error: "bad repo name" }, 400);
    if (await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(user, name).first()) return json({ error: "you already have a repo with that name" }, 409);
    const art = await r.handle.fork(`${user}--${name}`, { description: `${user}'s dig of ${level.title}`, defaultBranchOnly: true });
    const [tip] = await r.handle.log({ ref: level.branch, limit: 1 });
    await env.DB.prepare("INSERT INTO repos (owner, name, visibility, created_at, artifact, artifact_remote, branch, level, upstream, upstream_commit) VALUES (?, ?, 'public', ?, ?, ?, ?, ?, ?, ?)")
      .bind(user, name, Date.now(), art.name, art.remote, art.defaultBranch ?? level.branch, slug, `github:${level.repo}`, tip?.hash ?? null).run();
    return json({ owner: user, name }, 201);
  }
  return json({ error: "not found" }, 404);
}

