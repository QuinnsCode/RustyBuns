// A dug fork listens to its upstream (#870). A fork of a GitHub repo (or a level)
// keeps `upstream` and `upstream_commit`, the commit it was dug at. Only a mirror
// (mirror.ts) has git to fetch with, and only on the desktop; a fork asks GitHub
// over HTTP instead, so this works off Cloudflare Artifacts too:
//
//   Hear: is upstream's branch past upstream_commit, and by how many commits?
//         git's ref list on github.com first (no API, no rate limit), and GitHub's
//         compare API only once the tip moved. The hourly cron hears each fork;
//         opening the repo page does too, when it last heard a while ago.
//   Take: what upstream changed since upstream_commit opens here as a branch, one
//         file at a time (merged into main's live lines where those moved on too,
//         upstream winning where they touch the same lines), to be reviewed and
//         merged like any other. upstream_commit moves up to what it took.
//
//   GET  /api/repos/:o/:r/upstream        where the fork stands with upstream (hears when it's stale)
//   POST /api/repos/:o/:r/upstream/hear   (owner) hear now
//   POST /api/repos/:o/:r/upstream/take {name?}  (owner) open upstream's new changes as branch `name`
//
// Without a token GitHub's API allows 60 calls an hour per IP, and Cloudflare's are
// shared, so the owner's token (github.ts githubToken) goes along when there is one.

import { materialize, toFile } from "./archive.ts";
import { fromDisk } from "./agent-run.ts";
import { createOn, deleteOn, materializeOn } from "./branches.ts";
import { branchNameError, json, readBody, type Env } from "./env.ts";
import { gh, githubToken, gitTip } from "./github.ts";
import { emit } from "./hooks.ts";
import type { Doc } from "./lines.ts";
import { diffToOps, merge3 } from "./sync.ts";

/** Hear a fork again once this long has passed, when its page opens. */
export const HEAR_EVERY = 10 * 60_000;
/** GitHub's compare lists at most this many files; past it, a take would miss some. */
const COMPARE_FILES = 300;

interface Fork { owner: string; name: string; branch: string | null; upstream: string; upstream_commit: string; upstream_tip: string | null; upstream_behind: number | null; upstream_heard_at: number | null }
const COLS = "owner, name, branch, upstream, upstream_commit, upstream_tip, upstream_behind, upstream_heard_at";
/** A fork that can listen: dug from GitHub, at a known commit, and not a mirror (which listens with git). */
const LISTENS = "upstream LIKE 'github:%' AND upstream_commit IS NOT NULL AND mirror_url IS NULL";

/** `github:owner/name`, or `github:owner/name/tree/<branch>/<folder>` for a dug folder (#381), as its parts. */
export function upstreamOf(upstream: string, branch: string | null) {
  const m = /^github:([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)(?:\/tree\/(.+))?$/.exec(upstream);
  if (!m) return null;
  const rest = m[2] ?? "", b = branch ?? "main";
  const folder = rest.startsWith(`${b}/`) ? rest.slice(b.length + 1) : "";
  return { repo: m[1]!, branch: b, folder };
}

const fork = (env: Env, owner: string, repo: string) =>
  env.DB.prepare(`SELECT ${COLS} FROM repos WHERE owner = ? AND name = ? AND ${LISTENS}`).bind(owner, repo).first<Fork>();

const status = (f: Fork, error?: string) => {
  const up = upstreamOf(f.upstream, f.branch);
  return { listens: true, upstream: f.upstream, repo: up?.repo ?? null, branch: up?.branch ?? null, folder: up?.folder || null, commit: f.upstream_commit,
    tip: f.upstream_tip, behind: f.upstream_behind, heardAt: f.upstream_heard_at, ...(error ? { error } : {}) };
};

type Compare = { ahead_by: number; files?: { filename: string; status: string; previous_filename?: string }[] };
/** GitHub's compare of `base`...`head` on `repo`, or why not. */
async function compare(repo: string, base: string, head: string, token?: string): Promise<Compare | { error: string; status: number }> {
  const res = await gh(`/repos/${repo}/compare/${base}...${head}`, token);
  if (res.ok) return (await res.json()) as Compare;
  if (res.status === 404) return { error: `GitHub has no ${base.slice(0, 7)} on ${repo} to compare from any more`, status: 404 };
  if (res.status === 403 || res.status === 429) return { error: "GitHub's rate limit is spent; try again later, or sign in with GitHub", status: 429 };
  return { error: `GitHub said ${res.status}`, status: 502 };
}

/** Ask upstream where its branch is now, and keep it on the row. */
export async function hear(env: Env, f: Fork, now = Date.now()): Promise<{ fork: Fork; error?: string }> {
  const up = upstreamOf(f.upstream, f.branch);
  if (!up) return { fork: f, error: "upstream isn't a GitHub repo" };
  const token = (await githubToken(env, f.owner).catch(() => null))?.token;
  let tip: string | null = null, behind: number | null = null, error: string | undefined;
  // git's ref list costs no API call: when the tip hasn't moved, that's all it takes.
  tip = await gitTip(up.repo, up.branch).catch(() => null);
  if (tip === f.upstream_commit) behind = 0;
  else if (tip || token) {
    const c = await compare(up.repo, f.upstream_commit, tip ?? up.branch, token);
    if ("error" in c) error = c.error;
    else behind = c.ahead_by;
  } else error = `GitHub has no public ${up.repo} with a ${up.branch} branch`;
  const next = { ...f, upstream_tip: tip ?? f.upstream_tip, upstream_behind: error ? (tip && tip !== f.upstream_tip ? null : f.upstream_behind) : behind, upstream_heard_at: now };
  await env.DB.prepare("UPDATE repos SET upstream_tip = ?, upstream_behind = ?, upstream_heard_at = ? WHERE owner = ? AND name = ?")
    .bind(next.upstream_tip, next.upstream_behind, now, f.owner, f.name).run();
  return { fork: next, error };
}

/** The hourly cron: forks not heard in the last 50 minutes, longest unheard first, a few dozen at a time. */
export async function hearDue(env: Env, now = Date.now()) {
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM repos WHERE ${LISTENS} AND (upstream_heard_at IS NULL OR upstream_heard_at < ?) ORDER BY upstream_heard_at IS NOT NULL, upstream_heard_at LIMIT 40`)
    .bind(now - 50 * 60_000).all<Fork>();
  for (const f of results) await hear(env, f, now).catch(() => null);
}

/** `path` at `sha` on GitHub, as text; null when it isn't there (or isn't text). */
async function fileAt(repo: string, sha: string, path: string, token?: string) {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  const res = token
    ? await fetch(`https://api.github.com/repos/${repo}/contents/${enc}?ref=${sha}`, { headers: { accept: "application/vnd.github.raw", "user-agent": "codesplitter", authorization: `Bearer ${token}` } })
    : await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${enc}`, { headers: { "user-agent": "codesplitter" } });
  if (!res.ok) return null;
  const text = await res.text();
  return text.includes("\0") ? null : text;
}

/** Main's text of `path` here, or null when main has no such file. */
async function mainText(env: Env, owner: string, repo: string, path: string) {
  const m = await materialize(env, owner, repo, path);
  if ("error" in m) return null;
  return ((await (await toFile(env, owner, repo, path, "upstream", "file")).json()) as Doc).lines.map((l) => l.text);
}

/**
 * Open what upstream changed from upstream_commit to its tip as branch `b`: each
 * file it changed gets a copy on the branch with upstream's text, merged into
 * main's live lines where those moved on too (sync.ts merge3; upstream wins where
 * both touched the same lines). New files are new on the branch, deleted ones
 * deleted. A file main already has as upstream does is left be; a binary one is
 * skipped (a fork's git can't take its bytes here). Then upstream_commit moves up.
 */
export async function takeUpstream(env: Env, f: Fork, user: string, name?: string) {
  const up = upstreamOf(f.upstream, f.branch);
  if (!up) return json({ error: "upstream isn't a GitHub repo" }, 409);
  const token = (await githubToken(env, f.owner).catch(() => null))?.token;
  const tip = await gitTip(up.repo, up.branch).catch(() => null) ?? f.upstream_tip;
  if (!tip) return json({ error: `GitHub has no ${up.repo} with a ${up.branch} branch` }, 404);
  if (tip === f.upstream_commit) return json({ error: "nothing new upstream" }, 409);
  const c = await compare(up.repo, f.upstream_commit, tip, token);
  if ("error" in c) return json({ error: c.error }, c.status);
  const changed = c.files ?? [];
  if (changed.length >= COMPARE_FILES) return json({ error: `upstream changed ${COMPARE_FILES} files or more, past what GitHub lists: dig it up again instead` }, 422);

  const b = name ?? `upstream-${tip.slice(0, 7)}`, bad = branchNameError(b);
  if (bad) return json({ error: `bad branch name: ${bad}` }, 400);
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO branches (owner, repo, name, by, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").bind(f.owner, f.name, b, user, Date.now()).run();
  if (!claim.meta?.changes) return json({ error: "branch exists" }, 409);

  // Paths here: under the dug folder, with it taken off the front.
  const here = (p: string) => !up.folder ? p : p.startsWith(`${up.folder}/`) ? p.slice(up.folder.length + 1) : null;
  const files: string[] = [], deleted: string[] = [], skipped: string[] = [];
  const drop = async (path: string) => { ((await deleteOn(env, f.owner, f.name, b, path)).ok ? deleted : skipped).push(path); };
  for (const x of changed) {
    if (x.status === "renamed" && x.previous_filename) { const was = here(x.previous_filename); if (was && await mainText(env, f.owner, f.name, was)) await drop(was); }
    const path = here(x.filename);
    if (!path || x.status === "unchanged") continue;
    if (x.status === "removed") { if (await mainText(env, f.owner, f.name, path)) await drop(path); continue; }
    const text = await fileAt(up.repo, tip, x.filename, token);
    if (text === null) { skipped.push(path); continue; }
    const next = fromDisk(text), main = await mainText(env, f.owner, f.name, path);
    if (main === null) { ((await createOn(env, f.owner, f.name, b, path, text.replace(/\n$/, ""), "upstream")).ok ? files : skipped).push(path); continue; }
    if (main.join("\n") === next.join("\n")) continue;
    const m = await materializeOn(env, f.owner, f.name, b, path);
    if ("error" in m) { skipped.push(path); continue; }
    const doc = (await (await toFile(env, f.owner, f.name, path, "upstream", "file", {}, "", b)).json()) as Doc;
    const was = fromDisk((await fileAt(up.repo, f.upstream_commit, x.previous_filename ?? x.filename, token)) ?? "");
    const ops = diffToOps(doc.lines, merge3(was, doc.lines.map((l) => l.text), next) ?? next);
    if (ops.length) await toFile(env, f.owner, f.name, path, "upstream", "ops", { method: "POST", body: JSON.stringify({ ops, ifRev: doc.rev }) }, "", b);
    files.push(path);
  }
  await env.DB.prepare("UPDATE repos SET upstream_commit = ?, upstream_tip = ?, upstream_behind = 0, upstream_heard_at = ? WHERE owner = ? AND name = ?").bind(tip, tip, Date.now(), f.owner, f.name).run();
  await emit(env, f.owner, f.name, "branch.opened", user, { ref: b, ref_type: "branch", master_branch: "main" });
  return json({ name: b, from: f.upstream_commit, commit: tip, commits: c.ahead_by, files, deleted, skipped }, 201);
}

/** /api/repos/:o/:r/upstream[/hear|take]: reading is for anyone who can read the repo, the rest for its owner. */
export async function listenRoute(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null) {
  if (p[4] !== "upstream") return null;
  const f = await fork(env, owner, repo);
  if (!f) return !p[5] && req.method === "GET" ? json({ listens: false }) : json({ error: "not a fork of a GitHub repo" }, 404);
  if (!p[5] && req.method === "GET") {
    if (f.upstream_heard_at && Date.now() - f.upstream_heard_at < HEAR_EVERY) return json(status(f));
    const h = await hear(env, f);
    return json(status(h.fork, h.error));
  }
  if (req.method !== "POST" || p[6]) return null;
  if (user !== owner) return json({ error: "owner only" }, 403);
  if (p[5] === "hear") { const h = await hear(env, f); return json(status(h.fork, h.error)); }
  if (p[5] === "take") {
    const { name } = await readBody<"name">(req);
    if (name !== undefined && typeof name !== "string") return json({ error: "name: the branch to open" }, 400);
    return takeUpstream(env, f, user, name);
  }
  return null;
}
