// A big level dug up by a swarm (#344). GitHub's tarball is one gzip stream,
// so one Worker has to read it start to end; Bun takes minutes that way. The
// swarm skips the tarball: one call lists the tip's whole tree, the files are
// split into parts of about a chunk each (chunks.ts), and each part is a
// message on LEVEL_DIGS. The queue runs parts side by side (its consumer's
// maxConcurrency caps how hard GitHub gets hit); each fetches its files raw,
// writes its chunk to R2 and its files' entries to level_parts. The last part
// in writes the level's trees and marks it ready. Retried parts redo the same
// chunk, so a retry or a second assembly changes nothing.

import { CHUNK, chunkKey, dropChunks, fileType, keep, skipped, writeTrees, type ChunkFile } from "./chunks.ts";
import { MAX_BYTES } from "./archive.ts";
import type { Env, R2Like } from "./env.ts";

/** One part: the files it fetches, as [path, mode, size]. */
export interface DigPart { sha: string; n: number; files: [string, string, number][] }

/** A part's size: most files it fetches (well under a Worker's subrequests), and how many at once. Tests shrink it. */
export const PART = { files: 250, atOnce: 12 };

/** A fetch GitHub turned away for now (rate limited, or down): try the part again later. */
export class Later extends Error {}

const raw = (repo: string, sha: string, path: string) =>
  `https://raw.githubusercontent.com/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;

/**
 * Plan level `slug`'s dig at `sha`: list the tree, split it into parts and send
 * them. Null when GitHub's listing is truncated (over 100k entries), for the
 * caller to read the tarball instead. Returns how many parts went out.
 */
export async function planSwarm(env: Env & { LEVEL_DIGS: NonNullable<Env["LEVEL_DIGS"]> }, bucket: R2Like,
  p: { slug: string; repo: string; sha: string; message: string; user: string | null; token?: string }): Promise<number | null> {
  const res = await fetch(`https://api.github.com/repos/${p.repo}/git/trees/${p.sha}?recursive=1`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "codesplitters", ...(p.token ? { authorization: `Bearer ${p.token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status} listing ${p.repo}'s tree`);
  const tree = (await res.json()) as { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string; size?: number }[] };
  if (tree.truncated) return null;

  // Too big to dig is listed and not fetched; a submodule (type "commit") is a gitlink to its commit.
  const unstored: ChunkFile[] = [], parts: DigPart[] = [];
  let part: DigPart | null = null, bytes = 0;
  for (const f of tree.tree) {
    if (f.type === "commit") { unstored.push([f.path, { mode: "160000", type: "gitlink", hash: f.sha }]); continue; }
    if (f.type !== "blob") continue;
    const size = f.size ?? 0;
    if (size > MAX_BYTES) { unstored.push([f.path, { mode: f.mode, type: fileType(f.mode), hash: skipped(size, false) }]); continue; }
    if (!part || bytes + size > CHUNK || part.files.length >= PART.files) parts.push(part = { sha: p.sha, n: parts.length, files: [] }), bytes = 0;
    part.files.push([f.path, f.mode, size]);
    bytes += size;
  }

  await dropChunks(bucket, p.slug);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM level_parts WHERE slug = ?").bind(p.slug),
    env.DB.prepare("INSERT INTO level_parts (slug, sha, n, files) VALUES (?, ?, -1, ?)").bind(p.slug, p.sha, JSON.stringify(unstored)),
    env.DB.prepare(`INSERT INTO levels (slug, status, store, commit_hash, commit_message, parts, imported_at) VALUES (?, 'importing', 'r2', ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET status = 'importing', store = 'r2', error = NULL, commit_hash = excluded.commit_hash, commit_message = excluded.commit_message, parts = excluded.parts, imported_at = excluded.imported_at`)
      .bind(p.slug, p.sha, p.message, parts.length, Date.now()),
  ]);
  // A batch send holds 100 messages and 256 KB; a part's message is up to ~30 KB.
  for (let i = 0; i < parts.length; i += 6) await env.LEVEL_DIGS.sendBatch(parts.slice(i, i + 6).map((part) => ({ body: { dig: p.slug, user: p.user, part } })));
  if (!parts.length) await assemble(env, p.slug, p.sha);
  return parts.length;
}

/** Is the level still being dug at `sha`? A part from an older dig has nothing left to do. */
async function current(env: Env, slug: string, sha: string) {
  const row = await env.DB.prepare("SELECT status, commit_hash, parts FROM levels WHERE slug = ?").bind(slug).first();
  return row && row.commit_hash === sha && (row.status === "importing" || row.status === "assembling") ? (row.parts as number) : null;
}

/** Fetch one part's files, write its chunk and its entries; the last part in assembles the level. */
export async function digPart(env: Env, bucket: R2Like, slug: string, repo: string, part: DigPart) {
  const parts = await current(env, slug, part.sha);
  if (parts === null) return;
  const got: (Uint8Array | null)[] = new Array(part.files.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PART.atOnce, part.files.length) }, async () => {
    while (next < part.files.length) {
      const i = next++, [path] = part.files[i]!;
      const res = await fetch(raw(repo, part.sha, path), { headers: { "user-agent": "codesplitters" } });
      if (res.status === 429 || res.status >= 500) throw new Later(`GitHub said ${res.status} for ${path}`);
      if (!res.ok) throw new Error(`GitHub said ${res.status} for ${repo}'s ${path}`);
      got[i] = new Uint8Array(await res.arrayBuffer());
    }
  }));

  const files: ChunkFile[] = [], kept: Uint8Array[] = [];
  let offset = 0;
  part.files.forEach(([path, mode], i) => {
    const data = got[i]!;
    if (!keep(data)) return files.push([path, { mode, type: fileType(mode), hash: skipped(data.length, data.includes(0)) }]);
    files.push([path, { mode, type: fileType(mode), hash: `${part.n}:${offset}:${data.length}` }]);
    kept.push(data), offset += data.length;
  });
  if (offset) await bucket.put(chunkKey(slug, part.sha, part.n), new Blob(kept as BlobPart[]));
  await env.DB.prepare("INSERT OR REPLACE INTO level_parts (slug, sha, n, files) VALUES (?, ?, ?, ?)").bind(slug, part.sha, part.n, JSON.stringify(files)).run();

  const done = await env.DB.prepare("SELECT count(*) AS n FROM level_parts WHERE slug = ? AND sha = ? AND n >= 0").bind(slug, part.sha).first();
  if ((done?.n as number) >= parts) await assemble(env, slug, part.sha);
}

/** Every part is in: write the level's trees and open it. Safe to run twice. */
async function assemble(env: Env, slug: string, sha: string) {
  await env.DB.prepare("UPDATE levels SET status = 'assembling' WHERE slug = ? AND commit_hash = ? AND status = 'importing'").bind(slug, sha).run();
  const { results } = await env.DB.prepare("SELECT files FROM level_parts WHERE slug = ? AND sha = ?").bind(slug, sha).all();
  await writeTrees(env, slug, sha, results.flatMap((r: any) => JSON.parse(r.files) as ChunkFile[]));
  await env.DB.prepare("UPDATE levels SET status = 'ready', error = NULL WHERE slug = ? AND commit_hash = ?").bind(slug, sha).run();
}

/** How far along a swarm dig is: parts in, of how many. */
export async function progress(env: Env, slug: string, sha: string, parts: number) {
  const done = await env.DB.prepare("SELECT count(*) AS n FROM level_parts WHERE slug = ? AND sha = ? AND n >= 0").bind(slug, sha).first();
  return { done: (done?.n as number) ?? 0, of: parts };
}
