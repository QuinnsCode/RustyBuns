// GitHub: find a token wherever this host has one, list the caller's repos, and
// dig one up. Digging up is a fork: the repo is cloned into a git repo the
// caller owns (local git on the desktop, Cloudflare Artifacts on the edge) and
// GitHub never hears about the edits.

import { accountsOn } from "./identity.ts";
import { json, NAME, type Env } from "./env.ts";

const API = "https://api.github.com";

/**
 * A GitHub token, and where it came from: a GITHUB_TOKEN secret, the caller's
 * GitHub sign-in (accounts on), or the GitHub CLI on this machine (the desktop,
 * which is one person's). Null means public repos only, at GitHub's lower rate limit.
 */
export async function githubToken(env: Env, user: string | null): Promise<{ token: string; via: "secret" | "account" | "gh" } | null> {
  if (env.GITHUB_TOKEN) return { token: env.GITHUB_TOKEN, via: "secret" };
  if (accountsOn(env)) {
    if (!user) return null;
    const r = await env.DB.prepare(`SELECT a.accessToken FROM account a JOIN users u ON u.auth_id = a.userId WHERE u.name = ? AND a.providerId = 'github'`).bind(user).first();
    return r?.accessToken ? { token: r.accessToken, via: "account" } : null;
  }
  if (typeof Bun === "undefined" || env.GH_CLI === "off") return null;
  try {
    const out = Bun.spawnSync(["gh", "auth", "token"], { stderr: "ignore" });
    const token = out.success ? out.stdout.toString().trim() : "";
    return token ? { token, via: "gh" } : null;
  } catch { return null; }   // no gh installed
}

const gh = (path: string, token?: string) => fetch(API + path, {
  headers: { accept: "application/vnd.github+json", "user-agent": "codesplitters", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});

/** "owner/name", a github.com URL, or a git remote, as owner/name. */
export function parseRepo(s: string): string | null {
  const m = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(s.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** /api/github/... */
export async function githubRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] !== "github") return null;
  const t = await githubToken(env, user);

  // GET /api/github/repos  who GitHub thinks you are, and your repos, newest push first
  if (p[2] === "repos" && req.method === "GET") {
    if (!t) return json({ via: null, login: null, repos: [] });
    const [me, list] = await Promise.all([gh("/user", t.token), gh("/user/repos?per_page=100&sort=pushed", t.token)]);
    if (!me.ok) return json({ via: t.via, login: null, repos: [], error: `GitHub said ${me.status}` });
    const repos = list.ok ? ((await list.json()) as any[]).map((r) => ({ repo: r.full_name, private: r.private, branch: r.default_branch, description: r.description })) : [];
    return json({ via: t.via, login: ((await me.json()) as any).login, repos });
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
    if (visibility !== "public" && visibility !== "private") return json({ error: "visibility: public or private" }, 400);
    if (await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ?").bind(user, name).first()) return json({ error: "you already have a repo with that name" }, 409);

    const meta = await gh(`/repos/${full}`, t?.token);
    if (meta.status === 404) return json({ error: `GitHub has no ${full} you can see` }, 404);
    if (!meta.ok) return json({ error: `GitHub said ${meta.status}` }, 502);
    const info = (await meta.json()) as { full_name: string; default_branch: string; private: boolean };
    // The clone is anonymous, so a private repo can be listed but not dug up yet.
    if (info.private) return json({ error: `${full} is private on GitHub; only public repos can be dug up so far` }, 422);
    const head = await gh(`/repos/${info.full_name}/commits/${info.default_branch}`, t?.token);
    const sha = head.ok ? ((await head.json()) as { sha: string }).sha : null;

    // Shallow, like the levels; writable, because it's yours now.
    const art = await env.ARTIFACTS.import({
      source: { url: `https://github.com/${info.full_name}.git`, branch: info.default_branch, depth: 1 },
      target: { name: `${user}--${name}`, opts: { description: `${user}'s fork of ${info.full_name}` } },
    });
    await env.DB.prepare("INSERT INTO repos (owner, name, visibility, created_at, artifact, artifact_remote, branch, upstream, upstream_commit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(user, name, visibility, Date.now(), art.name, art.remote, info.default_branch, `github:${info.full_name}`, sha).run();
    return json({ owner: user, name, upstream: `github:${info.full_name}`, commit: sha }, 201);
  }
  return null;
}
