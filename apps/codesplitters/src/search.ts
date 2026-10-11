// Code search, one index per repo (#626). Each repo's committed text sits in an FTS5
// table in its own Durable Object (RepoSearch, SQLite-backed), so a big dig fills its
// own 10 GB, not D1's. D1 keeps one small row per repo (repo_search): its sizes, for
// the scale sideboard, and which repos have anything to search.
//
// In one repo, a search is one DO. Across repos it fans out to the repos you can see,
// yours first, then the most recently committed, at most FAN_OUT of them, and merges
// by rank. Past that, search across repos wants AI Search or Vectorize (scale.ts).
//
// What was in D1's file_search before moves over with POST /api/admin/scale/search-move.

import { json, type Env } from "./env.ts";

/** The most repos one search across repos asks. */
export const FAN_OUT = 50;

/** Words to an FTS5 query that matches them all, each taken literally. */
export const ftsQuery = (q: string) => q.split(/\s+/).filter(Boolean).map((w) => `"${w.replace(/"/g, '""')}"`).join(" ");

interface Size { files: number; text: number; size: number; big_path: string | null; big_bytes: number; big_lines: number }
export interface Hit { owner: string; repo: string; path: string; snippet: string }

export class RepoSearch {
  sql: any;
  constructor(ctx: any) {
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(path, content)");
    // Each file's size beside the index, so the sizes never read the text back.
    this.sql.exec("CREATE TABLE IF NOT EXISTS sizes (path TEXT PRIMARY KEY, bytes INTEGER NOT NULL, lines INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS sizes_bytes ON sizes (bytes)");
  }

  size(): Size {
    const t = this.sql.exec("SELECT COUNT(*) AS files, COALESCE(SUM(bytes), 0) AS text FROM sizes").one();
    const big = this.sql.exec("SELECT path, bytes, lines FROM sizes ORDER BY bytes DESC LIMIT 1").toArray()[0];
    return { files: t.files, text: t.text, size: this.sql.databaseSize, big_path: big?.path ?? null, big_bytes: big?.bytes ?? 0, big_lines: big?.lines ?? 0 };
  }

  drop(path: string) {
    this.sql.exec("DELETE FROM search WHERE path = ?", path);
    this.sql.exec("DELETE FROM sizes WHERE path = ?", path);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    switch (url.pathname) {
      // {files: [{path, content}]}: each file's last commit, in place of what it had.
      case "/put": {
        const { files } = (await req.json()) as { files: { path: string; content: string }[] };
        for (const f of files) {
          this.drop(f.path);
          this.sql.exec("INSERT INTO search (path, content) VALUES (?, ?)", f.path, f.content);
          this.sql.exec("INSERT INTO sizes (path, bytes, lines) VALUES (?, ?, ?)", f.path, new TextEncoder().encode(f.content).length, f.content.split("\n").length);
        }
        return Response.json(this.size());
      }
      case "/drop": {
        this.drop(((await req.json()) as { path: string }).path);
        return Response.json(this.size());
      }
      case "/wipe": {
        this.sql.exec("DELETE FROM search");
        this.sql.exec("DELETE FROM sizes");
        return Response.json(this.size());
      }
      // ?q=<fts query>&limit=: best first; rank is bm25, lower is better.
      case "/search": {
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
        const rows = this.sql.exec("SELECT path, snippet(search, 1, '«', '»', '…', 16) AS snippet, rank FROM search WHERE search MATCH ? ORDER BY rank LIMIT ?",
          url.searchParams.get("q") ?? "", limit).toArray();
        return Response.json(rows);
      }
      case "/size": return Response.json(this.size());
    }
    return new Response("not found", { status: 404 });
  }
}

export const searchStub = (env: Env, owner: string, repo: string) => env.SEARCH.get(env.SEARCH.idFromName(`${owner}/${repo}`));

const call = async <T>(env: Env, owner: string, repo: string, path: string, body?: unknown): Promise<T> => {
  const res = await searchStub(env, owner, repo).fetch(new Request(`https://search${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }));
  if (!res.ok) throw new Error(`search ${path}: ${res.status}`);
  return (await res.json()) as T;
};

/** Note the repo's index sizes in D1; `paths` also leave the old D1 index, so a move never brings back a stale copy. */
async function noteSize(env: Env, owner: string, repo: string, s: Size, paths: string[]) {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO repo_search (owner, repo, files, text_bytes, size_bytes, big_path, big_bytes, big_lines, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, repo) DO UPDATE SET files = excluded.files, text_bytes = excluded.text_bytes, size_bytes = excluded.size_bytes,
        big_path = excluded.big_path, big_bytes = excluded.big_bytes, big_lines = excluded.big_lines, updated_at = excluded.updated_at`)
      .bind(owner, repo, s.files, s.text, s.size, s.big_path, s.big_bytes, s.big_lines, Date.now()),
    // Until file_search is dropped (after the move): see the file's header.
    ...paths.map((p) => env.DB.prepare("DELETE FROM file_search WHERE owner = ? AND repo = ? AND path = ?").bind(owner, repo, p)),
  ]);
}

/** Index what was committed to `path` (private lines already blank). */
export async function indexFile(env: Env, owner: string, repo: string, path: string, content: string) {
  await noteSize(env, owner, repo, await call<Size>(env, owner, repo, "/put", { files: [{ path, content }] }), [path]);
}

/** `path` is gone from main: out of the index too. */
export async function unindexFile(env: Env, owner: string, repo: string, path: string) {
  await noteSize(env, owner, repo, await call<Size>(env, owner, repo, "/drop", { path }), [path]);
}

/** The repo is gone: empty its index (its D1 row goes with the repo's other rows). */
export async function wipeSearch(env: Env, owner: string, repo: string) {
  await call(env, owner, repo, "/wipe", {}).catch(() => null);
}

/** One repo's hits, best first, with each one's rank. */
async function inRepo(env: Env, owner: string, repo: string, q: string, limit: number) {
  const rows = await call<{ path: string; snippet: string; rank: number }[]>(env, owner, repo, `/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  return rows.map((r) => ({ owner, repo, ...r }));
}

const strip = ({ rank: _, ...h }: Hit & { rank: number }): Hit => h;

/** Search one repo the caller may read (checked by the caller). */
export async function searchRepo(env: Env, owner: string, repo: string, words: string, limit = 20): Promise<Hit[]> {
  const q = ftsQuery(words);
  return q ? (await inRepo(env, owner, repo, q, limit)).map(strip) : [];
}

/** Search every repo `user` can see, up to FAN_OUT of them: theirs first, then the most recently committed. */
export async function searchAll(env: Env, user: string | null, words: string, limit = 20): Promise<Hit[]> {
  const q = ftsQuery(words);
  if (!q) return [];
  const mine = "(r.owner = ? OR EXISTS (SELECT 1 FROM collaborators c WHERE c.owner = r.owner AND c.repo = r.name AND c.name = ?))";
  const { results } = await env.DB.prepare(`
    SELECT s.owner, s.repo FROM repo_search s JOIN repos r ON r.owner = s.owner AND r.name = s.repo
    WHERE s.files > 0 AND (r.expires_at IS NULL OR r.expires_at > ?) AND (r.visibility = 'public' OR ${mine})
    ORDER BY ${mine} DESC, s.updated_at DESC LIMIT ?`).bind(Date.now(), user, user, user, user, FAN_OUT).all();
  const each = await Promise.all((results as { owner: string; repo: string }[]).map((r) => inRepo(env, r.owner, r.repo, q, limit).catch(() => [])));
  return each.flat().sort((a, b) => a.rank - b.rank).slice(0, limit).map(strip);
}

/** Admins: move up to `batch` rows of D1's old file_search into the repos' own indexes. Call until `left` is 0. */
export async function moveSearch(env: Env, batch = 50) {
  const { results } = await env.DB.prepare("SELECT rowid, owner, repo, path, content FROM file_search LIMIT ?").bind(batch).all();
  const byRepo = new Map<string, { owner: string; repo: string; files: { path: string; content: string }[] }>();
  for (const r of results as { owner: string; repo: string; path: string; content: string }[]) {
    const k = `${r.owner}/${r.repo}`;
    if (!byRepo.has(k)) byRepo.set(k, { owner: r.owner, repo: r.repo, files: [] });
    byRepo.get(k)!.files.push({ path: r.path, content: r.content });
  }
  for (const { owner, repo, files } of byRepo.values()) {
    await noteSize(env, owner, repo, await call<Size>(env, owner, repo, "/put", { files }), files.map((f) => f.path));
  }
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM file_search").first();
  return { moved: results.length, repos: byRepo.size, left: Number(left?.n ?? 0) };
}

export async function searchRoutes(req: Request, env: Env, p: string[], admin: boolean): Promise<Response | null> {
  if (p[1] === "admin" && p[2] === "scale" && p[3] === "search-move") {
    if (!admin) return json({ error: "admins only" }, 403);
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    return json(await moveSearch(env));
  }
  return null;
}
