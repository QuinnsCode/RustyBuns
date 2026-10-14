// Code search, one index per repo (#626). Each repo's committed text sits in an FTS5
// table in its own Durable Object (RepoSearch, SQLite-backed), so a big dig fills its
// own 10 GB, not D1's. D1 keeps one small row per repo (repo_search): its sizes, for
// the scale sideboard, and which repos have anything to search.
//
// In one repo, a search is one DO. Across repos, with VECTORS and AI bound (#636), one
// Vectorize index over every repo's code picks the repos worth asking: each committed file
// is embedded in chunks, tagged with its repo and whether that was public. The query's
// nearest chunks among what the caller can see (D1 decides, not the tags) name up to ROUTE
// repos; their FTS5 hits come first, then the nearest chunks themselves. Without the index
// (the desktop, or before CODESPLITTER_VECTORS=1), or while it has nothing yet, a search
// across repos fans out to the repos you can see, yours first, then the most recently
// committed, at most FAN_OUT of them, and merges by rank.
//
// A commit embeds its file as it's indexed. What's left over (files from before the index,
// a repo whose visibility changed, an embed that failed) is counted in repo_search.stale,
// and the hourly cron embeds it (embedDue), as does POST /api/admin/scale/search-embed.

import { json, type Env } from "./env.ts";
import { repoRow } from "./repos.ts";
import { digest, hex } from "./util.ts";

/** The most repos one search across repos asks without the vector index. */
export const FAN_OUT = 50;
/** The most repos the vector index sends one search to. */
export const ROUTE = 10;
/** The embedding model: 384 dimensions, as rustybuns.config.ts makes the index. */
export const MODEL = "@cf/baai/bge-small-en-v1.5";
/** Lines per embedded chunk, and the most chunks of one file (FTS5 still has all of it). */
export const CHUNK = 40, MAX_CHUNKS = 16;

/** Words to an FTS5 query that matches them all, each taken literally. */
export const ftsQuery = (q: string) => q.split(/\s+/).filter(Boolean).map((w) => `"${w.replace(/"/g, '""')}"`).join(" ");

interface Size { files: number; text: number; size: number; big_path: string | null; big_bytes: number; big_lines: number; stale: number }
/** A file to embed, and how many chunks of it the vector index had (their ids to clear). */
interface ToEmbed { path: string; content: string; was: number }
export interface Hit { owner: string; repo: string; path: string; snippet: string }

export class RepoSearch {
  sql: any;
  constructor(ctx: any) {
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(path, content)");
    // Each file's size beside the index, so the sizes never read the text back.
    this.sql.exec("CREATE TABLE IF NOT EXISTS sizes (path TEXT PRIMARY KEY, bytes INTEGER NOT NULL, lines INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS sizes_bytes ON sizes (bytes)");
    // How many chunks of each file the vector index holds, and whether they're of its last commit.
    this.sql.exec("CREATE TABLE IF NOT EXISTS vectors (path TEXT PRIMARY KEY, chunks INTEGER NOT NULL, fresh INTEGER NOT NULL)");
  }

  chunks(path: string): number {
    return this.sql.exec("SELECT chunks FROM vectors WHERE path = ?", path).toArray()[0]?.chunks ?? 0;
  }

  size(): Size {
    const t = this.sql.exec("SELECT COUNT(*) AS files, COALESCE(SUM(bytes), 0) AS text FROM sizes").one();
    const big = this.sql.exec("SELECT path, bytes, lines FROM sizes ORDER BY bytes DESC LIMIT 1").toArray()[0];
    const stale = this.sql.exec("SELECT COUNT(*) AS n FROM sizes s LEFT JOIN vectors v ON v.path = s.path WHERE v.fresh IS NOT 1").one().n;
    return { files: t.files, text: t.text, size: this.sql.databaseSize, big_path: big?.path ?? null, big_bytes: big?.bytes ?? 0, big_lines: big?.lines ?? 0, stale };
  }

  drop(path: string) {
    this.sql.exec("DELETE FROM search WHERE path = ?", path);
    this.sql.exec("DELETE FROM sizes WHERE path = ?", path);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    switch (url.pathname) {
      // {files: [{path, content}]}: each file's last commit, in place of what it had. Its vectors are
      // stale until /embedded; `was` says how many chunks of each the vector index has.
      case "/put": {
        const { files } = (await req.json()) as { files: { path: string; content: string }[] };
        const was: Record<string, number> = {};
        for (const f of files) {
          this.drop(f.path);
          this.sql.exec("INSERT INTO search (path, content) VALUES (?, ?)", f.path, f.content);
          this.sql.exec("INSERT INTO sizes (path, bytes, lines) VALUES (?, ?, ?)", f.path, new TextEncoder().encode(f.content).length, f.content.split("\n").length);
          this.sql.exec("UPDATE vectors SET fresh = 0 WHERE path = ?", f.path);
          was[f.path] = this.chunks(f.path);
        }
        return Response.json({ ...this.size(), was });
      }
      // {path}: gone, and `chunks` of it to clear from the vector index.
      case "/drop": {
        const { path } = (await req.json()) as { path: string };
        const chunks = this.chunks(path);
        this.drop(path);
        this.sql.exec("DELETE FROM vectors WHERE path = ?", path);
        return Response.json({ ...this.size(), chunks });
      }
      case "/wipe": {
        const vectors = this.sql.exec("SELECT path, chunks FROM vectors").toArray();
        for (const t of ["search", "sizes", "vectors"]) this.sql.exec(`DELETE FROM ${t}`);
        return Response.json({ ...this.size(), vectors });
      }
      // ?limit=: files whose vectors aren't of their last commit, with their text.
      case "/stale": {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
        return Response.json(this.sql.exec(`SELECT s.path, s.content, COALESCE(v.chunks, 0) AS was FROM search s
          LEFT JOIN vectors v ON v.path = s.path WHERE v.fresh IS NOT 1 LIMIT ?`, limit).toArray());
      }
      // {files: [{path, chunks}]}: the vector index now has these chunks of each file's last commit.
      case "/embedded": {
        const { files } = (await req.json()) as { files: { path: string; chunks: number }[] };
        for (const f of files) this.sql.exec(`INSERT INTO vectors (path, chunks, fresh) VALUES (?, ?, 1)
          ON CONFLICT (path) DO UPDATE SET chunks = excluded.chunks, fresh = 1`, f.path, f.chunks);
        return Response.json(this.size());
      }
      // The repo's visibility changed: every vector's tag is out of date.
      case "/restale": {
        this.sql.exec("UPDATE vectors SET fresh = 0");
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

/** Note the repo's index sizes in D1. */
async function noteSize(env: Env, owner: string, repo: string, s: Size) {
  await env.DB.prepare(`INSERT INTO repo_search (owner, repo, files, text_bytes, size_bytes, big_path, big_bytes, big_lines, stale, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, repo) DO UPDATE SET files = excluded.files, text_bytes = excluded.text_bytes, size_bytes = excluded.size_bytes,
        big_path = excluded.big_path, big_bytes = excluded.big_bytes, big_lines = excluded.big_lines, stale = excluded.stale, updated_at = excluded.updated_at`)
      .bind(owner, repo, s.files, s.text, s.size, s.big_path, s.big_bytes, s.big_lines, s.stale, Date.now()).run();
}

// ---- the vector index across repos ----

export const vectorsOn = (env: Env) => !!(env.VECTORS && env.AI);

/** A chunk's vector id: Vectorize takes 64 bytes, so the file is a hash and the chunk its number. */
async function vid(owner: string, repo: string, path: string, i: number) {
  return `${hex((await digest(`${owner}/${repo}/${path}`)).slice(0, 20))}:${i}`;
}
const vids = (owner: string, repo: string, path: string, n: number) => Promise.all(Array.from({ length: n }, (_, i) => vid(owner, repo, path, i)));

/** A file's chunks to embed, by number; blank ones are skipped but keep their number. */
export function chunksOf(content: string): { i: number; line: number; text: string }[] {
  const lines = content.split("\n");
  const out: { i: number; line: number; text: string }[] = [];
  for (let i = 0; i < MAX_CHUNKS && i * CHUNK < lines.length; i++) {
    const text = lines.slice(i * CHUNK, (i + 1) * CHUNK).join("\n").trim();
    if (text) out.push({ i, line: i * CHUNK + 1, text });
  }
  return out;
}

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  // bge-small reads the first 512 tokens of each, and takes 100 texts a call.
  for (let k = 0; k < texts.length; k += 100) out.push(...(await env.AI!.run(MODEL, { text: texts.slice(k, k + 100).map((t) => t.slice(0, 2000)) })).data);
  return out;
}

async function dropVectors(env: Env, ids: string[]) {
  for (let k = 0; k < ids.length; k += 1000) await env.VECTORS!.deleteByIds(ids.slice(k, k + 1000));
}

/** Embed `files` of a repo, clear the chunk numbers they no longer fill, and note it in the repo's DO and D1. */
async function embedFiles(env: Env, owner: string, repo: string, files: ToEmbed[]) {
  const r = await repoRow(env, owner, repo, "visibility");
  if (!r || !files.length) return;
  const pub = r.visibility === "public";
  const each = files.map((f) => ({ ...f, chunks: chunksOf(f.content) }));
  const flat = each.flatMap((f) => f.chunks.map((c) => ({ path: f.path, ...c })));
  const values = await embed(env, flat.map((c) => `${c.path}\n${c.text}`));
  const vectors = await Promise.all(flat.map(async (c, k) => ({
    id: await vid(owner, repo, c.path, c.i), values: values[k]!,
    metadata: { repo: `${owner}/${repo}`, pub, path: c.path, line: c.line, text: c.text.slice(0, 400) },
  })));
  for (let k = 0; k < vectors.length; k += 1000) await env.VECTORS!.upsert(vectors.slice(k, k + 1000));
  const gone: string[] = [];
  for (const f of each) {
    const kept = new Set(f.chunks.map((c) => c.i));
    for (const [i, id] of (await vids(owner, repo, f.path, f.was)).entries()) if (!kept.has(i)) gone.push(id);
  }
  await dropVectors(env, gone);
  const done = each.map((f) => ({ path: f.path, chunks: Math.max(0, ...f.chunks.map((c) => c.i + 1)) }));
  await noteSize(env, owner, repo, await call<Size>(env, owner, repo, "/embedded", { files: done }));
}

/** Embed up to `limit` of a repo's stale files. */
async function embedRepo(env: Env, owner: string, repo: string, limit: number) {
  const files = await call<ToEmbed[]>(env, owner, repo, `/stale?limit=${limit}`);
  await embedFiles(env, owner, repo, files);
  return files.length;
}

/** The hourly cron, and search-embed: embed up to `budget` stale files, the most recently committed repos first. */
export async function embedDue(env: Env, budget = 200) {
  if (!vectorsOn(env)) return { embedded: 0, left: 0 };
  const { results } = await env.DB.prepare("SELECT owner, repo FROM repo_search WHERE stale > 0 ORDER BY updated_at DESC LIMIT 20").all();
  let embedded = 0;
  for (const r of results as { owner: string; repo: string }[]) {
    if (embedded >= budget) break;
    embedded += await embedRepo(env, r.owner, r.repo, Math.min(50, budget - embedded)).catch(() => 0);
  }
  const left = await env.DB.prepare("SELECT COALESCE(SUM(stale), 0) AS n FROM repo_search").first();
  return { embedded, left: Number(left?.n ?? 0) };
}

/** The repo's visibility changed: the next embedDue tags its vectors again. Until then D1 hides what went private. */
export async function restaleSearch(env: Env, owner: string, repo: string) {
  if (!vectorsOn(env)) return;
  await noteSize(env, owner, repo, await call<Size>(env, owner, repo, "/restale", {}));
}

// ---- each repo's index ----

/** Index what was committed to `path` (private lines already blank). */
export async function indexFile(env: Env, owner: string, repo: string, path: string, content: string) {
  const s = await call<Size & { was: Record<string, number> }>(env, owner, repo, "/put", { files: [{ path, content }] });
  await noteSize(env, owner, repo, s);
  // An embed that fails stays stale for the cron; the commit goes on.
  if (vectorsOn(env)) await embedFiles(env, owner, repo, [{ path, content, was: s.was[path] ?? 0 }]).catch(() => null);
}

/** `path` is gone from main: out of the index too. */
export async function unindexFile(env: Env, owner: string, repo: string, path: string) {
  const s = await call<Size & { chunks: number }>(env, owner, repo, "/drop", { path });
  await noteSize(env, owner, repo, s);
  if (vectorsOn(env)) await dropVectors(env, await vids(owner, repo, path, s.chunks)).catch(() => null);
}

/** The repo is gone: empty its index (its D1 row goes with the repo's other rows). */
export async function wipeSearch(env: Env, owner: string, repo: string) {
  const s = await call<{ vectors: { path: string; chunks: number }[] }>(env, owner, repo, "/wipe", {}).catch(() => null);
  if (!s || !vectorsOn(env)) return;
  const ids = (await Promise.all(s.vectors.map((v) => vids(owner, repo, v.path, v.chunks)))).flat();
  await dropVectors(env, ids).catch(() => null);
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

const MINE = "(r.owner = ? OR EXISTS (SELECT 1 FROM collaborators c WHERE c.owner = r.owner AND c.repo = r.name AND c.name = ?))";

/**
 * Search every repo `user` can see: the repos the vector index routes to, or without it,
 * or when it routes nowhere (nothing embedded yet), up to FAN_OUT of them.
 */
export async function searchAll(env: Env, user: string | null, words: string, limit = 20): Promise<Hit[]> {
  const q = ftsQuery(words);
  if (!q) return [];
  if (vectorsOn(env)) {
    const hits = await searchRouted(env, user, words, q, limit).catch(() => null);
    if (hits?.length) return hits;
  }
  return fanOut(env, user, q, limit);
}

/** The vector index picks up to ROUTE repos: their FTS5 hits first, then its nearest chunks in files those didn't name. */
async function searchRouted(env: Env, user: string | null, words: string, q: string, limit: number): Promise<Hit[]> {
  const [v] = await embed(env, [words]);
  // Public repos' chunks, and the caller's own repos' (a filter is at most 2 KB of JSON, so the newest of them).
  const { results: own } = user
    ? await env.DB.prepare(`SELECT r.owner || '/' || r.name AS k FROM repos r WHERE ${MINE} ORDER BY r.created_at DESC LIMIT 100`).bind(user, user).all()
    : { results: [] };
  const mine: string[] = [];
  for (const { k } of own as { k: string }[]) if (JSON.stringify([...mine, k]).length < 1800) mine.push(k);
  const asks = [env.VECTORS!.query(v!, { topK: 100, filter: { pub: true }, returnMetadata: "indexed" })];
  if (mine.length) asks.push(env.VECTORS!.query(v!, { topK: 100, filter: { repo: { $in: mine } }, returnMetadata: "indexed" }));
  const seen = new Set<string>();
  const near = (await Promise.all(asks)).flatMap((r) => r.matches).sort((a, b) => b.score - a.score)
    .filter((m) => typeof m.metadata?.repo === "string" && !seen.has(m.id) && !!seen.add(m.id));
  // Who may see what is D1's to say, not the tag a vector got at its last embed.
  const named = [...new Set(near.map((m) => m.metadata!.repo as string))];
  if (!named.length) return [];
  const { results: ok } = await env.DB.prepare(`SELECT r.owner || '/' || r.name AS k FROM repos r WHERE r.owner || '/' || r.name IN (SELECT value FROM json_each(?))
    AND (r.expires_at IS NULL OR r.expires_at > ?) AND (r.visibility = 'public' OR ${MINE})`).bind(JSON.stringify(named), Date.now(), user, user).all();
  const visible = new Set((ok as { k: string }[]).map((r) => r.k));
  const route = named.filter((k) => visible.has(k)).slice(0, ROUTE);
  const each = await Promise.all(route.map((k) => { const [o, r] = k.split("/") as [string, string]; return inRepo(env, o, r, q, limit).catch(() => []); }));
  const hits = each.flat().sort((a, b) => a.rank - b.rank).slice(0, limit).map(strip);
  // Then the nearest chunks, one per file not already there.
  const ids = near.filter((m) => route.includes(m.metadata!.repo as string)).slice(0, 20).map((m) => m.id);
  if (hits.length >= limit || !ids.length) return hits;
  const got = new Map((await env.VECTORS!.getByIds(ids)).map((g) => [g.id, g.metadata ?? {}]));
  const files = new Set(hits.map((h) => `${h.owner}/${h.repo}/${h.path}`));
  for (const id of ids) {
    const md = got.get(id);
    if (!md || hits.length >= limit || files.has(`${md.repo}/${md.path}`)) continue;
    files.add(`${md.repo}/${md.path}`);
    const [owner, repo] = String(md.repo).split("/") as [string, string];
    hits.push({ owner, repo, path: String(md.path), snippet: String(md.text ?? "") });
  }
  return hits;
}

/** Up to FAN_OUT repos `user` can see, theirs first, then the most recently committed, merged by rank. */
async function fanOut(env: Env, user: string | null, q: string, limit: number): Promise<Hit[]> {
  const mine = MINE;
  const { results } = await env.DB.prepare(`
    SELECT s.owner, s.repo FROM repo_search s JOIN repos r ON r.owner = s.owner AND r.name = s.repo
    WHERE s.files > 0 AND (r.expires_at IS NULL OR r.expires_at > ?) AND (r.visibility = 'public' OR ${mine})
    ORDER BY ${mine} DESC, s.updated_at DESC LIMIT ?`).bind(Date.now(), user, user, user, user, FAN_OUT).all();
  const each = await Promise.all((results as { owner: string; repo: string }[]).map((r) => inRepo(env, r.owner, r.repo, q, limit).catch(() => [])));
  return each.flat().sort((a, b) => a.rank - b.rank).slice(0, limit).map(strip);
}

export async function searchRoutes(req: Request, env: Env, p: string[], admin: boolean): Promise<Response | null> {
  // POST /api/admin/scale/search-embed  one round of the cron's embedding; call until `left` is 0.
  if (p[1] === "admin" && p[2] === "scale" && p[3] === "search-embed") {
    if (!admin) return json({ error: "admins only" }, 403);
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (!vectorsOn(env)) return json({ error: "no vector index here (CODESPLITTER_VECTORS=1 binds it)" }, 409);
    return json(await embedDue(env));
  }
  return null;
}
