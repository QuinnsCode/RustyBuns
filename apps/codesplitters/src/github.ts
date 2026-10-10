// GitHub: find a token wherever this host has one, list the caller's repos, and
// dig one up. Digging up is a fork: the repo is cloned into a git repo the
// caller owns (local git on the desktop, Cloudflare Artifacts on the edge) and
// GitHub never hears about the edits.

import { symmetricDecrypt } from "better-auth/crypto";
import { accountsOn, isAdmin } from "./identity.ts";
import { fileStub } from "./archive.ts";
import { json, NAME, type Env } from "./env.ts";
import { importTarball, tooBigToImport } from "./tarball.ts";

/** A visitor's dig lasts a day; past the cap, the oldest goes first. Admins' digs keep. */
export const DIG_TTL = 24 * 3600_000;
export const digCap = (env: Env) => Math.max(1, Number(env.DIG_CAP) || 20);

const API = "https://api.github.com";

/**
 * Can this host's Artifacts clone a private repo? The desktop's local git can,
 * with the token. Cloudflare Artifacts imports public HTTPS remotes only.
 */
const privateDigs = (env: Env) => (env.ARTIFACTS as { privateImports?: boolean } | undefined)?.privateImports === true;

/**
 * A GitHub token, and where it came from: a GITHUB_TOKEN secret, the caller's
 * GitHub sign-in (accounts on), or the GitHub CLI on this machine (the desktop,
 * which is one person's). Null means public repos only, at GitHub's lower rate limit.
 */
export async function githubToken(env: Env, user: string | null): Promise<{ token: string; via: "secret" | "account" | "gh" } | null> {
  if (env.GITHUB_TOKEN) return { token: env.GITHUB_TOKEN, via: "secret" };
  if (accountsOn(env)) {
    if (!user) return null;
    const accounts = await githubAccounts(env, user);
    const a = accounts.find((x) => x.active);
    return a ? { token: await a.token(), via: "account" } : null;
  }
  if (typeof Bun === "undefined" || env.GH_CLI === "off") return null;
  try {
    const out = Bun.spawnSync(["gh", "auth", "token"], { stderr: "ignore" });
    const token = out.success ? out.stdout.toString().trim() : "";
    return token ? { token, via: "gh" } : null;
  } catch { return null; }   // no gh installed
}

/**
 * The GitHub accounts linked to `user`'s sign-in, oldest first, and which one digs:
 * the one they picked (users.github_account), else the one linked last. Tokens stay
 * encrypted until asked for; ones stored before encryption was on read as they are.
 */
export async function githubAccounts(env: Env, user: string) {
  const { results } = await env.DB.prepare(`SELECT a.id, a.accessToken, u.github_account AS pick FROM account a JOIN users u ON u.auth_id = a.userId
    WHERE u.name = ? AND a.providerId = 'github' AND a.accessToken IS NOT NULL ORDER BY a.createdAt, a.id`).bind(user).all();
  const rows = results as { id: string; accessToken: string; pick: string | null }[];
  const active = rows.find((r) => r.id === r.pick)?.id ?? rows.at(-1)?.id;
  return rows.map((r) => ({ id: r.id, active: r.id === active, token: () => openToken(env, r.accessToken) }));
}

/** Better Auth's encrypted token ($ba$ envelope, or hex from older versions) back to the token. */
const openToken = async (env: Env, t: string) =>
  t.startsWith("$ba$") || (t.length % 2 === 0 && /^[0-9a-f]+$/i.test(t)) ? symmetricDecrypt({ key: env.BETTER_AUTH_SECRET!, data: t }) : t;

const gh = (path: string, token?: string) => fetch(API + path, {
  headers: { accept: "application/vnd.github+json", "user-agent": "codesplitters", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});

/**
 * owner/name out of anything copied from GitHub: owner/name, a page URL (a
 * file, a branch, a PR...), an https or ssh remote, a raw file URL, or a
 * whole `git clone ...` or `gh repo clone ...` line.
 */
export function parseRepo(s: string): string | null {
  const words = s.trim().replace(/^(?:gh\s+repo\s+(?:clone|view|fork)|git\s+clone)\s+/, "").split(/\s+/);
  for (const w of words) {
    if (w.startsWith("-")) continue;   // a flag, like --depth
    const m = /^(?:(?:(?:https?|ssh|git):\/\/)?(?:[^@/\s]+@)?(?:www\.)?github\.com[:/]|(?:https?:\/\/)?raw\.githubusercontent\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#].*)?$/.exec(w);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}

/** Forget a repo: its rows, its files' Durable Objects, and its git. An expired dig goes this way, and so does a repo its owner deletes. */
export async function evict(env: Env, owner: string, name: string) {
  const r = await env.DB.prepare("SELECT artifact, crew_artifact, old_artifacts FROM repos WHERE owner = ? AND name = ?").bind(owner, name).first();
  const { results: files } = await env.DB.prepare("SELECT path, NULL AS branch FROM files WHERE owner = ? AND repo = ? UNION ALL SELECT path, branch FROM branch_files WHERE owner = ? AND repo = ?")
    .bind(owner, name, owner, name).all();
  await Promise.all((files as { path: string; branch: string | null }[]).map((f) =>
    fileStub(env, owner, name, f.path, f.branch ?? undefined).fetch(new Request("https://file/wipe", { method: "POST" })).catch(() => null)));
  await env.DB.batch(["repos|owner = ? AND name = ?", "collaborators", "files", "file_search", "branches", "branch_files", "shares", "tracks", "webhooks", "webhook_deliveries",
    "cuts", "deploys", "deploy_settings", "deploy_keys", "dep_watches", "fit_cache"].map((t) => {
    const [table, where = "owner = ? AND repo = ?"] = t.split("|");
    return env.DB.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(owner, name);
  }));
  // Its git, the crew's copy, any it moved off with a fresh start, and one still being copied.
  const fresh = await env.DB.prepare("SELECT artifact, state FROM fresh_starts WHERE owner = ? AND repo = ?").bind(owner, name).first();
  await env.DB.batch(["fresh_starts", "fresh_objects", "git_pending"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE owner = ? AND repo = ?`).bind(owner, name)));
  const arts = [r?.artifact, r?.crew_artifact, ...JSON.parse((r?.old_artifacts as string) ?? "[]"), fresh && fresh.state !== "done" ? fresh.artifact : null];
  for (const a of arts) if (a) await env.ARTIFACTS?.delete?.(a as string).catch(() => false);
}

/** The submodules at `sha` and the commit each points at: in .gitmodules, then one contents call each. */
export async function submodules(repo: string, sha: string, token?: string) {
  const res = await gh(`/repos/${repo}/contents/.gitmodules?ref=${sha}`, token);
  if (!res.ok) return [];
  const { content = "" } = (await res.json()) as { content?: string };
  const paths = [...atob(content.replace(/\s/g, "")).matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((m) => m[1]!).slice(0, 50);
  const found = await Promise.all(paths.map(async (path) => {
    const r = await gh(`/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`, token);
    const j = r.ok ? ((await r.json()) as { type?: string; sha?: string }) : null;
    return j?.type === "submodule" && j.sha ? { path, commit: j.sha } : null;
  }));
  return found.filter((m) => m !== null);
}

/** git's ref list for a public repo on github.com, not the API (see gitRefs). Null when GitHub won't list it. */
async function gitAdvert(repo: string) {
  const res = await fetch(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`, { headers: { "user-agent": "git/2.45 codesplitters" } });
  return res.ok ? res.text() : null;
}

/**
 * A public repo's default branch and its tip, from git's own ref list on github.com rather than
 * the API: without a token, the API's 60-an-hour limit is per IP, and Cloudflare's are shared,
 * so it's usually spent. Null when GitHub won't list it (missing, or private).
 */
export async function gitRefs(repo: string): Promise<{ branch: string; sha: string } | null> {
  const m = /([0-9a-f]{40}) HEAD\0[^\n]*?symref=HEAD:refs\/heads\/(\S+)/.exec((await gitAdvert(repo)) ?? "");
  return m ? { sha: m[1]!, branch: m[2]! } : null;
}

/** A public repo's commit at the tip of `branch`, from git's ref list. */
async function gitTip(repo: string, branch: string) {
  const want = ` refs/heads/${branch}`;
  for (const line of ((await gitAdvert(repo)) ?? "").split("\n")) {
    const m = /([0-9a-f]{40})( [^\0]*)/.exec(line);
    if (m?.[2] === want) return m[1]!;
  }
  return null;
}

/** RFC 2047's =?charset?B|Q?...?= words in a mail header, as text. */
const unmime = (s: string) => s.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=\s*/gi, (_, cs: string, enc: string, t: string) => {
  const bytes = enc.toLowerCase() === "b" ? Uint8Array.from(atob(t), (c) => c.charCodeAt(0))
    : Uint8Array.from(t.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), (c) => c.charCodeAt(0));
  try { return new TextDecoder(cs).decode(bytes); } catch { return t; }
});

/**
 * A public commit's message and author from its .patch on github.com, which isn't the API: the
 * mail header and message, read up to the diff and no further. Null when GitHub won't give one.
 */
async function gitCommit(repo: string, sha: string) {
  const res = await fetch(`https://github.com/${repo}/commit/${sha}.patch`, { headers: { "user-agent": "codesplitters" } });
  if (!res.ok || !res.body) return null;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  while (!/^---$/m.test(text) && text.length < 64 * 1024) {
    const { done, value } = await reader.read();
    if (done) break;
    text += value;
  }
  await reader.cancel().catch(() => {});
  const blank = text.indexOf("\n\n");
  if (!text.startsWith("From ") || blank < 0) return null;
  const head = text.slice(0, blank).replace(/\n[ \t]+/g, " ");
  const field = (k: string) => new RegExp(`^${k}: (.*)$`, "m").exec(head)?.[1];
  const from = /^(.*?)\s*<([^>]*)>$/.exec(unmime(field("From") ?? "")), subject = unmime(field("Subject") ?? "").replace(/^\[PATCH[^\]]*\]\s*/, "");
  const body = text.slice(blank + 2).split(/^---$/m)[0]!.trim();
  if (!subject) return null;
  return { message: body ? `${subject}\n\n${body}` : subject, author: { name: from?.[1]?.replace(/^"|"$/g, ""), email: from?.[2], date: field("Date") } };
}

/**
 * The commit at the tip of `repo`'s `branch`. Without a token it asks github.com, not the
 * API (#386): git for the tip, the commit's .patch for who and why.
 */
export async function githubHead(repo: string, branch: string, token?: string): Promise<{ sha: string; message: string; author?: { name?: string; email?: string; date?: string } }> {
  if (!token) {
    const sha = await gitTip(repo, branch);
    if (!sha) throw new Error(`GitHub has no public ${repo} with a ${branch} branch`);
    return { sha, ...((await gitCommit(repo, sha).catch(() => null)) ?? { message: `${branch} on GitHub` }) };
  }
  const head = await gh(`/repos/${repo}/commits/${branch}`, token);
  if (!head.ok) throw new Error(`GitHub said ${head.status} for ${repo}'s ${branch}`);
  const c = (await head.json()) as { sha: string; commit: { message: string; author?: { name?: string; email?: string; date?: string } } };
  return { sha: c.sha, message: c.commit.message, author: c.commit.author };
}

/** GitHub's tarball of `repo` at `sha`: without a token, straight from codeload, where the API sends you anyway. */
export const githubTarball = (repo: string, sha: string, token?: string) =>
  token ? gh(`/repos/${repo}/tarball/${sha}`, token) : fetch(`https://codeload.github.com/${repo}/tar.gz/${sha}`, { headers: { "user-agent": "codesplitters" } });

/**
 * Import `repo`'s `branch` at depth 1 into Artifact `target`. Past Cloudflare's
 * 40 MB import cap, which depth 1 can't get under, it comes from GitHub's
 * tarball instead, as one commit (tarball.ts).
 */
export async function importRepo(env: Env, src: { repo: string; branch: string; token?: string; private?: boolean },
  target: { name: string; opts?: { description?: string; readOnly?: boolean } }) {
  const ns = env.ARTIFACTS!;
  try {
    return await ns.import({ source: { url: `https://github.com/${src.repo}.git`, branch: src.branch, depth: 1, ...(src.private ? { token: src.token } : {}) }, target });
  } catch (e) {
    if (!tooBigToImport(e)) throw e;
    const c = await githubHead(src.repo, src.branch, src.token);
    return importTarball(ns, {
      tarball: () => githubTarball(src.repo, c.sha, src.token), submodules: () => submodules(src.repo, c.sha, src.token), repo: src.repo, sha: c.sha, branch: src.branch, target,
      message: c.message, author: (c.author?.name ?? src.repo.split("/")[0]!).replace(/[<>\n]/g, ""),
      email: c.author?.email?.replace(/[<>\n\s]/g, "") || undefined, at: Date.parse(c.author?.date ?? "") || undefined,
    });
  }
}

/** Drop the expired digs, then, to make room for `more`, the oldest past the cap. */
async function makeRoom(env: Env, more: number) {
  const { results } = await env.DB.prepare("SELECT owner, name, expires_at FROM repos WHERE expires_at IS NOT NULL ORDER BY expires_at").all();
  const live = results as { owner: string; name: string; expires_at: number }[];
  const expired = live.filter((r) => r.expires_at <= Date.now()).length;
  const drop = Math.max(expired, live.length - digCap(env) + more);
  for (const r of live.slice(0, drop)) await evict(env, r.owner, r.name);
}

/** /api/github/... */
export async function githubRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] !== "github") return null;
  const t = await githubToken(env, user);

  // GET /api/github/repos  who GitHub thinks you are, and your repos, newest push first
  if (p[2] === "repos" && req.method === "GET") {
    const privateOk = privateDigs(env);
    const temp = { temporary: !isAdmin(env, user), ttlHours: DIG_TTL / 3600_000 };
    // Every GitHub linked to this sign-in, by login, so the page can switch between them.
    const accounts = accountsOn(env) && user ? await Promise.all((await githubAccounts(env, user)).map(async (a) => {
      const me = await gh("/user", await a.token());
      return { id: a.id, active: a.active, login: me.ok ? ((await me.json()) as { login: string }).login : null };
    })) : undefined;
    const more = accounts ? { accounts } : {};
    if (!t) return json({ via: null, login: null, repos: [], privateOk, ...temp, ...more });
    const [me, list] = await Promise.all([gh("/user", t.token), gh("/user/repos?per_page=100&sort=pushed", t.token)]);
    if (!me.ok) return json({ via: t.via, login: null, repos: [], privateOk, ...temp, ...more, error: `GitHub said ${me.status}` });
    const repos = list.ok ? ((await list.json()) as any[]).map((r) => ({ repo: r.full_name, private: r.private, branch: r.default_branch, description: r.description })) : [];
    return json({ via: t.via, login: ((await me.json()) as any).login, repos, privateOk, ...temp, ...more });
  }

  // POST /api/github/active {id}  dig and list as this one of your linked GitHubs.
  // Linking and unlinking are Better Auth's (/api/auth/link-social, /api/auth/unlink-account).
  if (p[2] === "active" && req.method === "POST") {
    if (!user || !accountsOn(env)) return json({ error: "sign in first" }, 401);
    const { id } = (await req.json().catch(() => ({}))) as { id?: string };
    if (!(await githubAccounts(env, user)).some((a) => a.id === id)) return json({ error: "that GitHub isn't linked to you" }, 404);
    await env.DB.prepare("UPDATE users SET github_account = ? WHERE name = ?").bind(id, user).run();
    return json({ id });
  }

  // GET /api/github/search?q=  public repos on GitHub, best match first
  if (p[2] === "search" && req.method === "GET") {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 200);
    if (!q) return json({ repos: [] });
    const res = await gh(`/search/repositories?per_page=12&q=${encodeURIComponent(q + " is:public")}`, t?.token);
    if (!res.ok) return json({ repos: [], error: res.status === 403 || res.status === 429 ? "GitHub's search is rate limited; try again in a minute" : `GitHub said ${res.status}` }, 200);
    const items = ((await res.json()) as { items: any[] }).items ?? [];
    return json({ repos: items.map((r) => ({ repo: r.full_name, description: r.description, stars: r.stargazers_count, language: r.language })) });
  }

  // POST /api/github/dig {repo, name?, visibility?}  fork a GitHub repo into one you own here
  if (p[2] === "dig" && req.method === "POST") {
    if (!user) return json({ error: "sign in first" }, 401);
    if (!env.ARTIFACTS) return json({ error: "no Artifacts binding" }, 501);
    const b = (await req.json().catch(() => ({}))) as { repo?: string; name?: string; visibility?: string };
    const full = parseRepo(b.repo ?? "");
    if (!full) return json({ error: "give a GitHub repo as owner/name or its URL" }, 400);
    const name = b.name || full.split("/")[1]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!NAME.test(name)) return json({ error: "bad repo name" }, 400);
    const visibility = b.visibility ?? "public";
    const expires = isAdmin(env, user) ? null : Date.now() + DIG_TTL;
    if (visibility !== "public" && visibility !== "private") return json({ error: "visibility: public or private" }, 400);
    await makeRoom(env, 0);
    if (await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(user, name).first()) return json({ error: "you already have a repo with that name" }, 409);

    let info: { full_name: string; default_branch: string; private: boolean }, sha: string | null;
    if (t) {
      const meta = await gh(`/repos/${full}`, t.token);
      if (meta.status === 404) return json({ error: `GitHub has no ${full} you can see` }, 404);
      if (!meta.ok) return json({ error: `GitHub said ${meta.status}` }, 502);
      info = (await meta.json()) as typeof info;
      // A private repo needs a clone that carries the token, which only local git does.
      if (info.private && !privateDigs(env)) return json({ error: `${full} is private on GitHub. Cloudflare Artifacts can only import public repos, so dig it up in the desktop app instead` }, 422);
      const head = await gh(`/repos/${info.full_name}/commits/${info.default_branch}`, t.token);
      sha = head.ok ? ((await head.json()) as { sha: string }).sha : null;
    } else {
      // No token: ask git, not the API (see gitRefs). Only public repos answer it.
      const refs = await gitRefs(full);
      if (!refs) return json({ error: `GitHub has no public ${full}${privateDigs(env) ? ". Sign in with GitHub, or run gh auth login, to dig up a private one" : ""}` }, 404);
      info = { full_name: full, default_branch: refs.branch, private: false };
      sha = refs.sha;
    }

    if (expires) await makeRoom(env, 1);

    // Shallow, like the levels; writable, because it's yours now.
    let art;
    try {
      // No row owns this name (checked above), so an Artifact under it is an orphan: an import cut
      // off halfway stays "being imported" on Cloudflare and would block the name for good (#348).
      await env.ARTIFACTS.delete?.(`${user}--${name}`).catch(() => false);
      art = await importRepo(env, { repo: info.full_name, branch: info.default_branch, token: t?.token, private: info.private },
        { name: `${user}--${name}`, opts: { description: `${user}'s fork of ${info.full_name}` } });
    } catch (e) {
      return json({ error: `couldn't dig up ${info.full_name}: ${String((e as Error).message ?? e)}` }, 502);
    }
    await env.DB.prepare("INSERT INTO repos (owner, name, visibility, created_at, artifact, artifact_remote, branch, upstream, upstream_commit, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(user, name, visibility, Date.now(), art.name, art.remote, info.default_branch, `github:${info.full_name}`, sha, expires).run();
    return json({ owner: user, name, upstream: `github:${info.full_name}`, commit: sha, ...(expires ? { expires_at: expires } : {}) }, 201);
  }
  return null;
}
