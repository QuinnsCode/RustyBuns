// Personal API tokens: how a caller outside the browser (a script, Claude Code, an
// agent behind an MCP gateway like Executor) acts as you. Made and revoked on your
// profile page, sent as `Authorization: Bearer cst_…`, described by GET /api/openapi.json.
//
// What a token may do, and why:
//   - It acts as its owner, and counts against their rate limits like the page does.
//   - read tokens make GET requests only; write tokens anything their owner could.
//   - It always expires: 1 to 365 days, 30 by default. Expired or revoked, it's a 401,
//     never a quiet fall back to signed out.
//   - It's never an admin, even an admin's: /api/admin/* and level imports refuse it,
//     and it's never let past a rate limit.
//   - It can't make or revoke tokens, sign in or out, or claim a handle, so a leaked
//     one can't outlive itself. Those take the cookie.
//   - No WebSockets: a socket edits as well as reads, and the live page is the browser's.
//   - Only its SHA-256 is stored; the secret is shown once.
//
//   GET    /api/tokens       yours, without their secrets (cookie only)
//   POST   /api/tokens       {label, scope: read|write, days?}: the secret is shown this once
//   DELETE /api/tokens/:id   revoke it

import { json, type Env } from "./env.ts";
import { actingAs } from "./identity.ts";

export const SCOPES = ["read", "write"] as const;
export type Scope = (typeof SCOPES)[number];
export interface Token { id: string; user: string; scope: Scope; label: string; expires_at: number }

const DAY = 86_400_000, MAX_DAYS = 365, MAX_TOKENS = 20;
/** Routes a token never reaches: running the site, and the account itself. */
const COOKIE_ONLY = new Set(["admin", "auth", "login", "logout", "handle", "tokens"]);

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const hash = async (secret: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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
  const t = secret && await env.DB.prepare("SELECT id, name AS user, scope, label, expires_at, last_used_at FROM api_tokens WHERE hash = ?").bind(await hash(secret)).first() as (Token & { last_used_at: number | null }) | null;
  if (!t || t.expires_at <= now) return json({ error: "this API token is expired, revoked or wrong: make one on your profile page" }, 401, { "www-authenticate": 'Bearer error="invalid_token"' });
  if (COOKIE_ONLY.has(p[1] ?? "")) return json({ error: "API tokens can't reach this: sign in on the site" }, 403);
  if (p.at(-1) === "ws") return json({ error: "API tokens don't open live sockets: use the HTTP routes" }, 403);
  if (t.scope !== "write" && req.method !== "GET" && req.method !== "HEAD") return json({ error: "this API token is read-only" }, 403, { "www-authenticate": 'Bearer error="insufficient_scope", scope="write"' });
  // Last used, to the minute: one write a minute at most, not one a request.
  if (!t.last_used_at || now - t.last_used_at > 60_000) await env.DB.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(now, t.id).run();
  return { id: t.id, user: t.user, scope: t.scope, label: t.label, expires_at: t.expires_at };
}

/** /api/tokens: the signed-in person's own, by cookie (bearer() keeps tokens out). */
export async function tokenRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] !== "tokens") return null;
  if (!user) return json({ error: "sign in first" }, 401);
  if (!p[2] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, label, scope, last4, created_at, expires_at, last_used_at FROM api_tokens WHERE name = ? ORDER BY created_at DESC").bind(user).all();
    return json(results.map((t: any) => ({ ...t, expired: t.expires_at <= Date.now() })));
  }
  if (!p[2] && req.method === "POST") {
    const b = (await req.json().catch(() => ({}))) as { label?: string; scope?: string; days?: number };
    const label = String(b.label ?? "").trim().slice(0, 60);
    if (!label) return json({ error: "label: what it's for, like executor" }, 400);
    if (!SCOPES.includes(b.scope as Scope)) return json({ error: "scope: read or write" }, 400);
    const days = b.days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return json({ error: `days: 1 to ${MAX_DAYS}` }, 400);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE name = ? AND expires_at > ?").bind(user, Date.now()).first();
    if ((n?.n as number ?? 0) >= MAX_TOKENS) return json({ error: `at most ${MAX_TOKENS} live tokens: revoke one first` }, 400);
    const secret = "cst_" + b64url(crypto.getRandomValues(new Uint8Array(32)));
    const t = { id: crypto.randomUUID().slice(0, 8), label, scope: b.scope as Scope, last4: secret.slice(-4), created_at: Date.now(), expires_at: Date.now() + days * DAY };
    await env.DB.prepare("INSERT INTO api_tokens (id, name, label, hash, last4, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(t.id, user, t.label, await hash(secret), t.last4, t.scope, t.created_at, t.expires_at).run();
    return json({ ...t, token: secret }, 201);
  }
  if (p[2] && !p[3] && req.method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM api_tokens WHERE id = ? AND name = ?").bind(p[2], user).run();
    return r.meta?.changes ? json({ ok: true }) : json({ error: "no such token" }, 404);
  }
  return null;
}
