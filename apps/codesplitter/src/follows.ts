// Follow people, agents, repos and line ranges. A thin layer over what's already
// here: handles, repos, and line ids (a followed range is kept by id, like a share).
//   POST   /api/follows {name, kind?}             a person, or an agent (agent-… by default)
//   POST   /api/follows {owner, repo}             a repo
//   POST   /api/follows {owner, repo, path, from, to}  some lines; from/to are line numbers now
//   DELETE /api/follows/:id                       unfollow
//   GET    /api/me/following                      everything you follow
// Following again what you already follow answers the follow you have.
// A private repo, and lines in one, show only in its crew's list.

import { materialize, toFile } from "./archive.ts";
import { json, type Env, readBody, type Body } from "./env.ts";

export type Follow = { id: number; created_at: number } & (
  | { kind: "user" | "agent"; name: string }
  | { kind: "repo"; owner: string; repo: string }
  | { kind: "lines"; owner: string; repo: string; path: string; ids: string[]; from_line: number; to_line: number });

interface Row { id: number; follower: string; kind: Follow["kind"]; target: string; owner: string | null; repo: string | null; path: string | null; ids: string | null; from_line: number | null; to_line: number | null; created_at: number }

const toFollow = (r: Row): Follow =>
  r.kind === "user" || r.kind === "agent" ? { id: r.id, kind: r.kind, name: r.target, created_at: r.created_at }
  : r.kind === "repo" ? { id: r.id, kind: "repo", owner: r.owner!, repo: r.repo!, created_at: r.created_at }
  : { id: r.id, kind: "lines", owner: r.owner!, repo: r.repo!, path: r.path!, ids: JSON.parse(r.ids ?? "[]"), from_line: r.from_line!, to_line: r.to_line!, created_at: r.created_at };

/**
 * Everything `handle` follows, newest first, as `viewer` may see it (the follower themself by
 * default): a repo, or lines in one, only while it's public or the viewer is its crew, and not
 * once a visitor's dig has expired.
 */
export async function listFollows(db: Env["DB"], handle: string, viewer: string | null = handle): Promise<Follow[]> {
  const { results } = await db.prepare(`
    SELECT f.* FROM follows f LEFT JOIN repos r ON r.owner = f.owner AND r.name = f.repo
    WHERE f.follower = ? AND (f.kind IN ('user', 'agent') OR (r.owner IS NOT NULL AND (r.expires_at IS NULL OR r.expires_at > ?)
      AND (r.visibility = 'public' OR r.owner = ? OR EXISTS (SELECT 1 FROM collaborators c WHERE c.owner = r.owner AND c.repo = r.name AND c.name = ?))))
    ORDER BY f.created_at DESC, f.id DESC`).bind(handle, Date.now(), viewer, viewer).all<Row>();
  return results.map(toFollow);
}

/** How many follow `handle`, a person's or an agent's. */
export async function followers(db: Env["DB"], handle: string): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM follows WHERE kind IN ('user', 'agent') AND target = ?").bind(handle).first();
  return Number(r?.n ?? 0);
}

type Access = (owner: string, repo: string) => Promise<{ read: boolean; write: boolean }>;

/** What to follow, from a POST body: its kind, target and the columns to keep. */
async function resolve(env: Env, user: string, body: Body<"name" | "kind" | "owner" | "repo" | "path" | "from" | "to">, access: Access): Promise<Omit<Row, "id" | "follower" | "created_at"> | { error: string; status: number }> {
  const s = (k: keyof typeof body) => { const v = body[k]; return typeof v === "string" ? v.trim() : ""; };
  const none = { owner: null, repo: null, path: null, ids: null, from_line: null, to_line: null };
  if (s("name")) {
    const name = s("name").replace(/^@/, "");
    if (name === user) return { error: "you can't follow yourself", status: 400 };
    const kind = body.kind ?? (name.startsWith("agent-") ? "agent" : "user");
    if (kind !== "user" && kind !== "agent") return { error: "kind: user or agent, for a name", status: 400 };
    if (!(await env.DB.prepare("SELECT 1 FROM users WHERE name = ?").bind(name).first())) return { error: "no such user", status: 404 };
    return { kind, target: name, ...none };
  }
  const owner = s("owner"), repo = s("repo"), path = s("path");
  if (!owner || !repo) return { error: "follow a name, a repo (owner, repo), or lines (owner, repo, path, from, to)", status: 400 };
  // A private repo you're not crew of looks the same as one that doesn't exist.
  if (!(await access(owner, repo)).read) return { error: "not found", status: 404 };
  if (!path) return { kind: "repo", target: `${owner}/${repo}`, ...none, owner, repo };
  const m = await materialize(env, owner, repo, path);
  if ("error" in m) return m;
  const { lines } = (await (await toFile(env, owner, repo, path, user, "file", { headers: { "x-codesplitter-crew": "0" } })).json()) as { lines: { id: string }[] };
  const from = Math.max(1, Math.floor(Number(body.from))), to = Math.min(lines.length, Math.max(from, Math.floor(Number(body.to) || from)));
  if (!lines[from - 1]) return { error: "no such lines", status: 400 };
  if (to - from >= 500) return { error: "follow at most 500 lines", status: 400 };
  const ids = lines.slice(from - 1, to).map((l) => l.id);
  return { kind: "lines", target: `${owner}/${repo}/${path}#${ids[0]}..${ids.at(-1)}`, owner, repo, path, ids: JSON.stringify(ids), from_line: from, to_line: to };
}

export async function followRoutes(req: Request, env: Env, p: string[], user: string | null, access: Access): Promise<Response | null> {
  const listing = p[1] === "me" && p[2] === "following" && !p[3] && req.method === "GET";
  const following = p[1] === "follows" && ((!p[2] && req.method === "POST") || (p[2] && !p[3] && req.method === "DELETE"));
  if (!listing && !following) return null;
  if (!user) return json({ error: "sign in first" }, 401);
  if (listing) return json(await listFollows(env.DB, user));
  if (req.method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM follows WHERE id = ? AND follower = ?").bind(Number(p[2]), user).run();
    return r.meta?.changes ? json({ ok: true }) : json({ error: "not a follow of yours" }, 404);
  }
  const t = await resolve(env, user, await readBody(req), access);
  if ("error" in t) return json({ error: t.error }, t.status);
  const had = await env.DB.prepare("SELECT * FROM follows WHERE follower = ? AND kind = ? AND target = ?").bind(user, t.kind, t.target).first<Row>();
  if (had) return json(toFollow(had));
  const row = await env.DB.prepare("INSERT INTO follows (follower, kind, target, owner, repo, path, ids, from_line, to_line, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
    .bind(user, t.kind, t.target, t.owner, t.repo, t.path, t.ids, t.from_line, t.to_line, Date.now()).first<Row>();
  return json(toFollow(row!), 201);
}
