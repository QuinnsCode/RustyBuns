// Everything that touches a repo's git history in Artifacts: tokens, browsing
// trees, reading files, turning a file into a live Durable Object on first
// open, and pushing a catalogue as a commit.

import { fromText } from "./lines.ts";
import { push } from "./git.ts";
import { noodles, type Noodle } from "./noodles.ts";
import type { ArtifactsRepo, Env, TreeEntry } from "./env.ts";

/** A file's DO; on a branch, the branch's own copy of it ("@" can't appear in a repo name). */
export const fileStub = (env: Env, owner: string, repo: string, path: string, branch?: string) =>
  env.FILES.get(env.FILES.idFromName(`${owner}/${repo}${branch ? "@" + branch : ""}/${path}`));

/**
 * Call a file's DO (or its copy on `branch`) as `user`. The app's own calls
 * see private lines; a read made for someone passes `x-codesplitters-crew`
 * ("0" unless they're crew), so they see placeholders instead.
 */
export function toFile(env: Env, owner: string, repo: string, path: string, user: string, op: string, init: RequestInit = {}, search = "", branch?: string) {
  const headers = new Headers(init.headers);
  headers.set("x-codesplitters-user", user);
  if (!headers.has("x-codesplitters-crew")) headers.set("x-codesplitters-crew", "1");
  return fileStub(env, owner, repo, path, branch).fetch(new Request(`https://file/${op}${search}`, { ...init, headers }));
}

/**
 * The repo row's artifact handle and branch, or null when it has none. With
 * `crew`, the crew's remote when the repo has one (it holds private lines'
 * real text): what previews, deploys and the crew's own clone use.
 */
export async function handleFor(env: Env, owner: string, repo: string, crew = false) {
  const r = await env.DB.prepare("SELECT artifact, artifact_remote, crew_artifact, crew_remote, branch FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  if (!env.ARTIFACTS || !r?.artifact) return null;
  const [name, remote] = crew && r.crew_artifact ? [r.crew_artifact, r.crew_remote] : [r.artifact, r.artifact_remote];
  return { handle: await env.ARTIFACTS.get(name), branch: (r.branch ?? "main") as string, remote: remote as string, crew: name !== r.artifact };
}

/**
 * Give the repo its crew remote, once: a fork of its remote ("--crew" can't end
 * a two-part "owner--repo" name, so it can't collide), or a new repo before the
 * first commit. Commits push the real text there from then on.
 */
export async function ensureCrewRemote(env: Env, owner: string, repo: string) {
  const r = await env.DB.prepare("SELECT artifact, crew_artifact, branch FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  if (!env.ARTIFACTS || !r?.artifact || r.crew_artifact) return;
  const name = `${r.artifact}--crew`, branch = (r.branch ?? "main") as string, description = `codeSplitters ${owner}/${repo}, the crew's copy`;
  const pub = await env.ARTIFACTS.get(r.artifact);
  const made = await (async () => {
    const [tip] = await pub.log({ ref: branch, limit: 1 }).catch(() => []);
    return tip ? pub.fork(name, { description, defaultBranchOnly: true }) : env.ARTIFACTS!.create(name, { description, setDefaultBranch: branch });
  })().catch(async (e: Error) => {
    // Someone else made it a moment ago.
    const info = await (await env.ARTIFACTS!.get(name)).info().catch(() => null);
    if (!info) throw e;
    return info;
  });
  await env.DB.prepare("UPDATE repos SET crew_artifact = ?, crew_remote = ? WHERE owner = ? AND name = ?").bind(made.name, made.remote, owner, repo).run();
}

/** A remote and a fresh token for it. */
export async function access(handle: ArtifactsRepo, fallbackRemote: string, scope: "read" | "write", ttl: number) {
  const [info, token] = await Promise.all([handle.info().catch(() => null), handle.createToken(scope, ttl)]);
  return { remote: info?.remote ?? fallbackRemote, token: token.plaintext };
}

/** A tree is named by its hash and never changes, so D1 keeps every one we read forever. */
async function readTree(env: Env, handle: ArtifactsRepo, hash: string): Promise<TreeEntry[] | null> {
  const hit = await env.DB.prepare("SELECT entries FROM tree_cache WHERE hash = ?").bind(hash).first();
  if (hit) return JSON.parse(hit.entries);
  const entries = await handle.readTree(hash);
  if (entries) await env.DB.prepare("INSERT OR IGNORE INTO tree_cache (hash, entries) VALUES (?, ?)").bind(hash, JSON.stringify(entries)).run();
  return entries;
}

/** The entries of directory `dir` ("" for the root) at the tip of `ref`, folders first. */
export async function listDir(env: Env, handle: ArtifactsRepo, ref: string, dir: string) {
  const [tip] = await handle.log({ ref, limit: 1 });
  if (!tip) return { commit: null, entries: [] as { name: string; path: string; type: string }[] };
  let tree = tip.treeHash;
  for (const seg of dir.split("/").filter(Boolean)) {
    const next = (await readTree(env, handle, tree))?.find((e) => e.name === seg && e.type === "tree");
    if (!next) return { commit: tip, entries: null };
    tree = next.hash;
  }
  const entries = ((await readTree(env, handle, tree)) ?? [])
    .map((e) => ({ name: e.name, path: dir ? `${dir}/${e.name}` : e.name, type: e.type === "tree" ? "dir" : e.type === "blob" || e.type === "exec" ? "file" : e.type }))
    .sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
  return { commit: tip, entries };
}

export const MAX_BYTES = 256 * 1024, MAX_LINES = 5000;

/** A file's text, or why it can't be dug: missing, binary or too big. */
export async function readText(handle: ArtifactsRepo, ref: string, path: string): Promise<{ text: string } | { error: string; status: number }> {
  const blob = await handle.readFile({ ref, path });
  if (!blob) return { error: "no such file", status: 404 };
  if (blob.size > MAX_BYTES) return { error: `too big to dig (${Math.round(blob.size / 1024)} KB, the limit is ${MAX_BYTES / 1024} KB)`, status: 413 };
  const text = await blob.text();
  if (text.includes("\u0000")) return { error: "binary file", status: 415 };
  if (text.split("\n").length > MAX_LINES) return { error: `too long to dig (over ${MAX_LINES} lines)`, status: 413 };
  return { text };
}

/**
 * Make sure a file exists as a live Durable Object. Files written in the app
 * already do; a file from the repo's git history (an imported level, a fork)
 * becomes one the first time someone opens it, seeded from its last commit
 * and attributed to "upstream". Only touched files ever cost a DO.
 */
export async function materialize(env: Env, owner: string, repo: string, path: string): Promise<{ ok: true } | { error: string; status: number }> {
  if (await env.DB.prepare("SELECT 1 FROM files WHERE owner = ? AND repo = ? AND path = ?").bind(owner, repo, path).first()) return { ok: true };
  const h = await handleFor(env, owner, repo);
  if (!h) return { error: "no such file", status: 404 };
  const got = await readText(h.handle, h.branch, path);
  if ("error" in got) return got;
  const r = await env.DB.prepare("INSERT OR IGNORE INTO files (owner, repo, path) VALUES (?, ?, ?)").bind(owner, repo, path).run();
  // Two people opening it at once: only the one whose row landed seeds the DO.
  if (r.meta?.changes) await toFile(env, owner, repo, path, "upstream", "ops", { method: "POST", body: JSON.stringify({ ops: fromText(got.text.replace(/\n$/, "")) }) });
  return { ok: true };
}

/**
 * Push one catalogued file as a commit on top of the repo's branch; everything
 * else stays. The remote gets `published` (private lines blank); the crew
 * remote, when the file has private lines or the repo already has one, gets
 * `content`. The result is the remote's push; a crew push that failed is in `crewError`.
 */
export async function pushCatalogue(env: Env, owner: string, repo: string, path: string, files: { content: string; published: string }, author: string, message: string) {
  if (files.content !== files.published) await ensureCrewRemote(env, owner, repo);
  const [h, crew] = await Promise.all([handleFor(env, owner, repo), handleFor(env, owner, repo, true)]);
  if (!h) return null;
  const one = async (to: NonNullable<typeof h>, content: string) => {
    const a = await access(to.handle, to.remote, "write", 300);
    const text = content.endsWith("\n") ? content : content + "\n";
    return { remote: a.remote, ...(await push(a.remote, a.token, { changes: { [path]: text }, message, author, branch: to.branch, base: to.handle })) };
  };
  const [pub, crewPush] = await Promise.allSettled([one(h, files.published), crew?.crew ? one(crew, files.content) : null]);
  if (pub.status === "rejected") throw pub.reason;
  return crewPush.status === "rejected" ? { ...pub.value, crewError: (crewPush.reason as Error).message } : pub.value;
}

export interface Walls { commit: string | null; doors: { name: string; path: string }[]; files: { name: string; path: string; lines: string[]; noodles?: Noodle[] }[] }
// Bumped when a room carries something new, so cached rooms are built again.
const WALLS_V = "v2:";
const WALL_FILES = 12, WALL_DOORS = 12, WALL_LINES = 48, WALL_WIDTH = 90;

/**
 * One room of the backrooms: folder `dir`'s subfolders (doors) and the first
 * lines of its files (the walls). Cached in D1 by commit and folder, so a
 * level's room costs Artifacts reads once, ever; pass `commit` when it's known
 * (a level's import) to skip even the log read. Each file also carries its
 * type guards, the noodle monsters, when it has any.
 */
export async function walls(env: Env, handle: ArtifactsRepo, ref: string, dir: string, commit?: string | null): Promise<Walls | null> {
  const cached = async (c: string) => {
    const hit = await env.DB.prepare("SELECT data FROM walls_cache WHERE key = ?").bind(`${WALLS_V}${c}:${dir}`).first();
    return hit ? (JSON.parse(hit.data) as Walls) : null;
  };
  if (commit) { const hit = await cached(commit); if (hit) return hit; }
  const listing = await listDir(env, handle, ref, dir);
  if (!listing.entries) return null;
  const key = listing.commit?.hash ?? null;
  if (key && key !== commit) { const hit = await cached(key); if (hit) return hit; }
  const files = listing.entries.filter((e) => e.type === "file").slice(0, WALL_FILES);
  const out: Walls = {
    commit: key,
    doors: listing.entries.filter((e) => e.type === "dir").slice(0, WALL_DOORS).map(({ name, path }) => ({ name, path })),
    files: await Promise.all(files.map(async ({ name, path }) => {
      const got = await readText(handle, ref, path).catch(() => ({ error: "unreadable", status: 500 }));
      if (!("text" in got)) return { name, path, lines: [] };
      const lines = got.text.split("\n").slice(0, WALL_LINES).map((l) => l.replace(/\t/g, "  ").slice(0, WALL_WIDTH));
      const found = noodles(got.text, WALL_WIDTH);
      return found.length ? { name, path, lines, noodles: found } : { name, path, lines };
    })),
  };
  if (key) await env.DB.prepare("INSERT OR IGNORE INTO walls_cache (key, data) VALUES (?, ?)").bind(`${WALLS_V}${key}:${dir}`, JSON.stringify(out)).run();
  return out;
}
