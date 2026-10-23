// Layout: personal API tokens: make, revoke, and who a bearer token acts as
// Personal API tokens: how a caller outside the browser (a script, Claude Code, an
// agent behind an MCP gateway like Executor) acts as you. Made and revoked on your
// profile page, sent as `Authorization: Bearer cst_…`, described by GET /api/openapi.json.
//
// What a token may do, and why:
//   - It acts as its owner, and counts against their rate limits like the page does.
//   - read tokens make GET requests only; write tokens edit code, branches and checks;
//     admin tokens also manage the repo itself (adminRoute below): delete, visibility, crew,
//     invites, CI tokens, webhooks, deploy keys and check settings. OAuth grants are never admin.
//   - A token can be held to one repo (`repo` on POST /api/tokens), as an invite's is.
//   - It always expires: 1 to 365 days, 30 by default. Expired or revoked, it's a 401,
//     never a quiet fall back to signed out.
//   - It's never an admin, even an admin's: /api/admin/* and level imports refuse it,
//     and it's never let past a rate limit.
//   - It can't make or revoke tokens, sign in or out, or claim a handle, so a leaked
//     one can't outlive itself. Those take the cookie.
//   - No WebSockets: a socket edits as well as reads, and the live page is the browser's.
//   - One an agent got from an invite (invites.ts) is held to that repo: it reaches
//     /api/repos/<that one> and claiming another invite, and reads elsewhere only what
//     isn't a repo. Taking the agent out of that crew revokes it (#645).
//   - Only its SHA-256 is stored; the secret is shown once.
//   - An app signed in with OAuth (oauth.ts) gets the same kind of token, an hour long
//     and tied to its grant: these rules hold for it too, and it's never listed here.
//
//   GET    /api/tokens       yours, without their secrets (cookie only)
//   POST   /api/tokens       {label, scope: read|write|admin, days?, repo?: owner/name}: the secret is shown this once
//   DELETE /api/tokens/:id   revoke it
//   GET    /api/tokens/audit what you did that the audit log keeps (audit.ts)

import { json, type Env, readBody } from "./env.ts";
import { audit, via } from "./audit.ts";
import { actingAs } from "./identity.ts";
import { repoRow } from "./repos.ts";
import { b64url, sha256 } from "./util.ts";

export const SCOPES = ["read", "write", "admin"] as const;
export type Scope = (typeof SCOPES)[number];
export interface Token { id: string; user: string; scope: Scope; label: string; expires_at: number; repo: string | null; oauth: boolean }

export const DAY = 86_400_000, MAX_DAYS = 365;
const MAX_TOKENS = 20;
/** Routes a token never reaches: running the site, and the account itself. */
const COOKIE_ONLY = new Set(["admin", "auth", "login", "logout", "handle", "tokens", "oauth"]);


/** Whether a request signed in with an API or OAuth token. The gates that stand for a person reading the code (approve, accept, build_ok) refuse these. */
export const byToken = (req: Request) => { const v = via.get(req); return v === "token" || v === "oauth"; };

/** Whether a route manages a repo rather than its code: a write token is refused it, an admin one isn't. */
export const adminRoute = (p: string[], method: string) => {
  if (p[1] !== "repos" || !p[2] || !p[3] || method === "GET" || method === "HEAD") return false;
  const k = p[4];
  return !k || k === "collaborators" || k === "hooks" || k === "invites" || k === "protect" || (k === "deploy" && p[5] === "key") || (k === "checks" && (p[5] === "tokens" || p[5] === "settings"));
};

/** The bearer token a request carries, or null when it carries none. */
const bearerOf = (req: Request) => {
  const h = req.headers.get("authorization");
  return h ? /^Bearer\s+(\S+)$/i.exec(h)?.[1] ?? "" : null;
};

/**
 * Who a request's bearer token acts as, null when it has none (the cookie decides),
 * or the refusal: a bad token, or a route tokens can't reach.
 */
export async function bearer(req: Request, env: Env, p: string[]): Promise<Token | Response | null> {
  if (actingAs.has(req)) return null;
  const secret = bearerOf(req);
  if (secret === null) return null;
  const now = Date.now();
  const t = secret && await env.DB.prepare("SELECT id, name AS user, scope, label, expires_at, last_used_at, repo, grant_id IS NOT NULL AS oauth FROM api_tokens WHERE hash = ?").bind(await sha256(secret)).first() as (Token & { last_used_at: number | null }) | null;
  if (!t || t.expires_at <= now) return json({ error: "this API token is expired, revoked or wrong: make one on your profile page" }, 401, { "www-authenticate": 'Bearer error="invalid_token"' });
  if (COOKIE_ONLY.has(p[1] ?? "")) return json({ error: "API tokens can't reach this: sign in on the site" }, 403);
  if (p.at(-1) === "ws") return json({ error: "API tokens don't open live sockets: use the HTTP routes" }, 403);
  if (t.repo && !heldTo(t.repo, p, req.method, new URL(req.url).searchParams.get("repo"))) return json({ error: `this API token is for ${t.repo} only` }, 403);
  if (t.scope === "read" && req.method !== "GET" && req.method !== "HEAD") return json({ error: "this API token is read-only" }, 403, { "www-authenticate": 'Bearer error="insufficient_scope", scope="write"' });
  if (t.scope !== "admin" && adminRoute(p, req.method)) return json({ error: "this API token can't manage the repo itself (delete, visibility, crew, invites, CI tokens, webhooks, deploy keys, check settings): make an admin token on your profile page, or sign in on the site" }, 403, { "www-authenticate": 'Bearer error="insufficient_scope", scope="admin"' });
  // Last used, to the minute: one write a minute at most, not one a request.
  if (!t.last_used_at || now - t.last_used_at > 60_000) await env.DB.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(now, t.id).run();
  return { id: t.id, user: t.user, scope: t.scope, label: t.label, expires_at: t.expires_at, repo: t.repo, oauth: !!t.oauth };
}

/** Whether a token held to `repo` (owner/name) reaches this route: that repo, claiming an invite, or reading what isn't a repo (search and game walls name their repo too). */
const heldTo = (repo: string, p: string[], method: string, searchRepo: string | null) =>
  p[1] === "repos" && p[2] && p[3] ? `${p[2]}/${p[3]}` === repo
  : p[1] === "game" && p[2] === "r" && p[3] && p[4] ? `${p[3]}/${p[4]}` === repo
  : p[1] === "search" ? searchRepo === repo
  : (p[1] === "invites" && p[2] === "claim") || method === "GET" || method === "HEAD";

/** A new token for `user`, its secret in `token` this once. */
export async function mint(env: Env, user: string, label: string, scope: Scope, days: number, repo: string | null = null) {
  const secret = "cst_" + b64url(crypto.getRandomValues(new Uint8Array(32)));
  const t = { id: crypto.randomUUID().slice(0, 8), label, scope, last4: secret.slice(-4), created_at: Date.now(), expires_at: Date.now() + days * DAY };
  await env.DB.prepare("INSERT INTO api_tokens (id, name, label, hash, last4, scope, created_at, expires_at, repo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(t.id, user, t.label, await sha256(secret), t.last4, t.scope, t.created_at, t.expires_at, repo).run();
  return { ...t, token: secret };
}

/** /api/tokens: the signed-in person's own, by cookie (bearer() keeps tokens out). */
export async function tokenRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] !== "tokens") return null;
  if (!user) return json({ error: "sign in first" }, 401);
  if (!p[2] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, label, scope, repo, last4, created_at, expires_at, last_used_at FROM api_tokens WHERE name = ? AND grant_id IS NULL ORDER BY created_at DESC").bind(user).all();
    return json(results.map((t: any) => ({ ...t, expired: t.expires_at <= Date.now() })));
  }
  if (!p[2] && req.method === "POST") {
    const b = await readBody<"label" | "scope" | "days" | "repo">(req);
    const label = String(b.label ?? "").trim().slice(0, 60);
    if (!label) return json({ error: "label: what it's for, like executor" }, 400);
    const scope = SCOPES.find((s) => s === b.scope);
    if (!scope) return json({ error: "scope: read, write or admin" }, 400);
    const days = b.days ?? 30;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) return json({ error: `days: 1 to ${MAX_DAYS}` }, 400);
    const repo = b.repo == null || b.repo === "" ? null : String(b.repo);
    if (repo !== null) {
      const [o, r, ...rest] = repo.split("/");
      if (!o || !r || rest.length || !(await repoRow(env, o, r, "1"))) return json({ error: "repo: owner/name of one that exists" }, 400);
    }
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE name = ? AND grant_id IS NULL AND expires_at > ?").bind(user, Date.now()).first();
    if ((n?.n as number ?? 0) >= MAX_TOKENS) return json({ error: `at most ${MAX_TOKENS} live tokens: revoke one first` }, 400);
    const t = await mint(env, user, label, scope, days, repo);
    await audit(env, req, { actor: user, action: "token.create", target: t.id, detail: `${t.scope}${repo ? ` on ${repo}` : ""}: ${label}` });
    return json(t, 201);
  }
  if (p[2] && !p[3] && req.method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM api_tokens WHERE id = ? AND name = ? AND grant_id IS NULL").bind(p[2], user).run();
    if (!r.meta?.changes) return json({ error: "no such token" }, 404);
    await audit(env, req, { actor: user, action: "token.revoke", target: p[2] });
    return json({ ok: true });
  }
  return null;
}
