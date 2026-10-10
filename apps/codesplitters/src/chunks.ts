// Levels too big for Artifacts (Bun, Alchemy; #344): their tip from GitHub's
// tarball, kept as chunks in R2 instead of a git repo. Each chunk packs many
// files end to end (about 8 MB, so a big level is tens of objects, not tens of
// thousands); each folder's entries go in D1's tree_cache, as git trees do,
// with every file's chunk, offset and size as its hash. Reads take a range of
// one chunk, through the Cache API, so browsing a level costs R2 little.
//
// Only what can be dug is kept: text files up to MAX_BYTES. Binary and bigger
// files are listed but not stored. Read-only: there's no git to fork.

import { MAX_BYTES } from "./archive.ts";
import { tarFiles } from "./tarball.ts";
import type { ArtifactsRepo, CommitMeta, Env, R2Like, TreeEntry } from "./env.ts";

export const CHUNK = 8 * 2 ** 20;

const prefix = (slug: string) => `levels/${slug}/`;
const chunkKey = (slug: string, sha: string, n: number) => `${prefix(slug)}${sha}/${n}`;
/** A folder's tree_cache key: a git hash can't start with "r2:". */
const treeKey = (slug: string, sha: string, dir: string) => `r2:${slug}:${sha}:${dir}`;

/**
 * Read `repo`'s tarball into level `slug`'s chunks. Chunks from an earlier
 * import go first. Returns how much was kept.
 */
export async function importChunks(env: Env, bucket: R2Like, p: { slug: string; sha: string; tarball: () => Promise<Response>; repo: string }) {
  const res = await p.tarball();
  if (!res.ok || !res.body) throw new Error(`GitHub said ${res.status} for ${p.repo}'s tarball`);
  await dropChunks(bucket, p.slug);

  const dirs = new Map<string, TreeEntry[]>([["", []]]);
  const add = (path: string, entry: Omit<TreeEntry, "name">) => {
    const segs = path.split("/");
    for (let i = 1; i < segs.length; i++) {
      const dir = segs.slice(0, i).join("/");
      if (dirs.has(dir)) continue;
      dirs.set(dir, []);
      dirs.get(segs.slice(0, i - 1).join("/"))!.push({ name: segs[i - 1]!, mode: "40000", type: "tree", hash: treeKey(p.slug, p.sha, dir) });
    }
    dirs.get(segs.slice(0, -1).join("/"))!.push({ name: segs.at(-1)!, ...entry });
  };

  let n = 0, parts: Uint8Array[] = [], have = 0, files = 0, kept = 0, bytes = 0;
  const flush = async () => {
    if (!have) return;
    await bucket.put(chunkKey(p.slug, p.sha, n), new Blob(parts as BlobPart[]));
    n++, parts = [], have = 0;
  };
  for await (const f of tarFiles(res.body.pipeThrough(new DecompressionStream("gzip")))) {
    if (!("data" in f)) continue;
    files++;
    const type = f.mode === "120000" ? "symlink" : f.mode === "100755" ? "exec" : "blob";
    // Not stored: nobody can dig it. Its size (and whether it's binary) says why.
    if (f.data.length > MAX_BYTES || f.data.includes(0)) { add(f.path, { mode: f.mode, type, hash: `skip:${f.data.length}:${f.data.includes(0) ? 1 : 0}` }); continue; }
    if (have + f.data.length > CHUNK) await flush();
    add(f.path, { mode: f.mode, type, hash: `${n}:${have}:${f.data.length}` });
    parts.push(f.data), have += f.data.length, kept++, bytes += f.data.length;
  }
  await flush();

  const rows = [...dirs].map(([dir, entries]) => env.DB.prepare("INSERT OR REPLACE INTO tree_cache (hash, entries) VALUES (?, ?)").bind(treeKey(p.slug, p.sha, dir), JSON.stringify(entries)));
  for (let i = 0; i < rows.length; i += 100) await env.DB.batch(rows.slice(i, i + 100));
  return { files, kept, bytes, chunks: n };
}

/** Delete every chunk a level has. */
export async function dropChunks(bucket: R2Like, slug: string) {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: prefix(slug), cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** Bytes `offset`..`offset+size` of a chunk: from the cache, else a ranged R2 read that's then cached. A chunk never changes. */
async function piece(bucket: R2Like, key: string, offset: number, size: number) {
  if (!size) return new Uint8Array(0);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const url = `https://codesplitters-chunks.internal/${key}/${offset}-${size}`;
  const hit = await cache?.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const obj = await bucket.get(key, { range: { offset, length: size } });
  if (!obj) return null;
  let got = new Uint8Array(await obj.arrayBuffer());
  if (got.length > size) got = got.slice(offset, offset + size);   // a bucket that ignores ranges sends it all
  await cache?.put(url, new Response(got, { headers: { "cache-control": "public, max-age=31536000, immutable" } }));
  return got;
}

/**
 * Level `slug`'s chunks as a read-only repo at `sha`: enough of ArtifactsRepo
 * for browsing and the game (log, readTree, readFile). The rest refuse.
 */
export function chunkRepo(env: Env, bucket: R2Like, slug: string, tip: { sha: string; message: string }): ArtifactsRepo {
  const commit: CommitMeta = { hash: tip.sha, treeHash: treeKey(slug, tip.sha, ""), message: tip.message, parents: [], author: { name: "", email: "" }, authoredAt: 0 };
  const tree = async (hash: string): Promise<TreeEntry[] | null> => {
    const row = await env.DB.prepare("SELECT entries FROM tree_cache WHERE hash = ?").bind(hash).first();
    return row ? JSON.parse(row.entries) : null;
  };
  const refuse = async (): Promise<never> => { throw new Error("this level is too big for Artifacts: it's kept in R2, read-only, with no git"); };
  return {
    log: async () => [commit],
    readCommit: async (hash) => (hash === tip.sha ? commit : null),
    readTree: tree,
    async readFile({ path }) {
      const segs = path.split("/").filter(Boolean);
      const entry = (await tree(treeKey(slug, tip.sha, segs.slice(0, -1).join("/"))))?.find((e) => e.name === segs.at(-1) && e.type !== "tree");
      if (!entry) return null;
      const skip = /^skip:(\d+):([01])$/.exec(entry.hash);
      // Not stored: just enough of a Blob for readText to say too big, or binary.
      if (skip) return { size: Number(skip[1]), text: async () => (skip[2] === "1" ? "\0" : "") } as Blob;
      const [n, offset, size] = entry.hash.split(":").map(Number) as [number, number, number];
      const got = await piece(bucket, chunkKey(slug, tip.sha, n), offset, size);
      return got && new Blob([got]);
    },
    readBlob: refuse, info: refuse, createToken: refuse, fork: refuse,
  };
}
