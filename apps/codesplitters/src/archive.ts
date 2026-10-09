// Everything that touches a repo's git history in Artifacts: tokens, browsing
// trees, reading files, turning a file into a live Durable Object on first
// open, and pushing a catalogue as a commit.

import { fromText } from "./lines.ts";
import { push } from "./git.ts";
import type { ArtifactsRepo, Env, TreeEntry } from "./env.ts";

export const fileStub = (env: Env, owner: string, repo: string, path: string) =>
  env.FILES.get(env.FILES.idFromName(`${owner}/${repo}/${path}`));

/** Call a file's DO as `user`. */
export function toFile(env: Env, owner: string, repo: string, path: string, user: string, op: string, init: RequestInit = {}, search = "") {
  const headers = new Headers(init.headers);
  headers.set("x-codesplitters-user", user);
  return fileStub(env, owner, repo, path).fetch(new Request(`https://file/${op}${search}`, { ...init, headers }));
}

/** The repo row's artifact handle and branch, or null when it has none. */
export async function handleFor(env: Env, owner: string, repo: string) {
  const r = await env.DB.prepare("SELECT artifact, artifact_remote, branch FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  if (!env.ARTIFACTS || !r?.artifact) return null;
  return { handle: await env.ARTIFACTS.get(r.artifact), branch: (r.branch ?? "main") as string, remote: r.artifact_remote as string };
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

/** Push one catalogued file as a commit on top of the repo's branch; everything else stays. */
export async function pushCatalogue(env: Env, owner: string, repo: string, path: string, content: string, author: string, message: string) {
  const h = await handleFor(env, owner, repo);
  if (!h) return null;
  const a = await access(h.handle, h.remote, "write", 300);
  const text = content.endsWith("\n") ? content : content + "\n";
  return { remote: a.remote, ...(await push(a.remote, a.token, { changes: { [path]: text }, message, author, branch: h.branch, base: h.handle })) };
}
