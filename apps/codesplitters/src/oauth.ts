// OAuth sign-in: an app outside the browser (Executor's Add account, an MCP client like
// Claude Code) opens a codeSplitters page, you say yes, and it gets tokens without you
// copying one. OAuth 2.1's authorization code flow with PKCE, for public clients only.
//
// What it hands out, and why:
//   - An access token is a personal API token (tokens.ts) an hour long, tied to its grant:
//     the same rules hold (never an admin, no sockets, no account routes, read only GETs).
//   - A refresh token lasts 30 days from its last use, and a grant a year at most. It's
//     rotated on every use; the old one shown again means it leaked, and the grant goes.
//   - Scope is read or write. The app asks; you pick on the consent page, and a refresh
//     never widens it.
//   - A code works once, for 10 minutes, for the client, redirect and PKCE verifier
//     (S256 only) it was made for.
//   - An app on your own computer (a loopback redirect, any port) needn't register: its
//     client_id is a name it picks, shown to you as that. Anything else registers first
//     (POST /api/oauth/register) and may only send you back to an https URL it gave then.
//   - The consent form takes the cookie, never a token, from this site only (SameSite
//     cookies, an Origin check, an unguessable form id), and can't be framed.
//   - Each grant shows on your profile page, beside your tokens; revoking it deletes its
//     tokens at once. Only hashes of codes and tokens are stored.
//
//   GET  /.well-known/oauth-authorization-server   RFC 8414 metadata
//   GET  /.well-known/oauth-protected-resource[/…]  RFC 9728: /api/mcp's, for MCP clients
//   GET  /api/oauth/authorize    the consent page        POST: its form
//   POST /api/oauth/token        authorization_code | refresh_token
//   POST /api/oauth/register     RFC 7591 dynamic registration {redirect_uris, client_name?}
//   POST /api/oauth/revoke       RFC 7009 {token}
//   GET  /api/oauth/grants       yours (cookie only)     DELETE /api/oauth/grants/:id

import { json, type Env } from "./env.ts";
import { identify } from "./identity.ts";
import { b64url, DAY, hash, MAX_DAYS } from "./tokens.ts";

export const OAUTH_SCOPES = { read: "read what you can read", write: "read, and change what you can change" } as const;
const HOUR = 3_600_000, CODE_MS = 10 * 60_000, REFRESH_MS = 30 * DAY, GRANT_MS = MAX_DAYS * DAY;

const random = (prefix: string) => prefix + b64url(crypto.getRandomValues(new Uint8Array(32)));
const id = () => crypto.randomUUID().slice(0, 8);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const NO_STORE = { "cache-control": "no-store" };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS" };
const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status, { ...NO_STORE, ...CORS });

/** The metadata MCP clients and gateways find the endpoints by. The issuer is the site. */
export function metadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: Object.keys(OAUTH_SCOPES),
    service_documentation: `${origin}/reference`,
  };
}

/** GET /.well-known/…: null when it's none of ours. */
export function wellKnown(req: Request, p: string[], origin: string): Response | null {
  if (p[0] !== ".well-known") return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return null;
  if (p[1] === "oauth-authorization-server" || p[1] === "openid-configuration") return json(metadata(origin), 200, CORS);
  if (p[1] === "oauth-protected-resource") {
    // The suffix names the resource (/api/mcp); bare, it's the whole API.
    const resource = p.length > 2 ? `${origin}/${p.slice(2).join("/")}` : `${origin}/api`;
    return json({ resource, authorization_servers: [origin], scopes_supported: Object.keys(OAUTH_SCOPES), bearer_methods_supported: ["header"], resource_name: "codeSplitters" }, 200, CORS);
  }
  return null;
}

const loopback = (u: URL) => u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
const parse = (s: string) => { try { return new URL(s); } catch { return null; } };

/** A redirect URI an app may register: https, or back to this computer. Never with a fragment. */
const registrable = (s: unknown) => {
  const u = typeof s === "string" ? parse(s) : null;
  return !!u && !u.hash && (u.protocol === "https:" || loopback(u));
};

/** Same URI, except a loopback one may change its port (RFC 8252 §7.3). */
const sameRedirect = (registered: string, asked: string) => {
  if (registered === asked) return true;
  const a = parse(registered), b = parse(asked);
  if (!a || !b || !loopback(a) || !loopback(b)) return false;
  a.port = b.port = "";
  return a.href === b.href;
};

/** Who client_id is, and that redirect_uri is one of its own; or why not. */
async function client(env: Env, clientId: string, redirectUri: string): Promise<{ name: string; local: boolean; registered: boolean } | string> {
  const redirect = parse(redirectUri);
  if (!clientId || clientId.length > 80 || /[\x00-\x1f<>]/.test(clientId)) return "client_id is missing or odd";
  if (!redirect || redirect.hash) return "redirect_uri is missing or not a URL";
  if (clientId.startsWith("csc_")) {
    const c = await env.DB.prepare("SELECT name, redirect_uris FROM oauth_clients WHERE id = ?").bind(clientId).first() as { name: string; redirect_uris: string } | null;
    if (!c) return "no such client: register again";
    if (!(JSON.parse(c.redirect_uris) as string[]).some((r) => sameRedirect(r, redirectUri))) return "that redirect_uri isn't one this client registered";
    return { name: c.name, local: loopback(redirect), registered: true };
  }
  // Unregistered: only an app on this computer, named by itself.
  if (!loopback(redirect)) return "an unregistered client may only redirect to this computer (http://127.0.0.1 or localhost): register at /api/oauth/register";
  return { name: clientId, local: true, registered: false };
}

/** Back to the app with these, as a 303 (the form's POST becomes its GET). */
const back = (redirectUri: string, params: Record<string, string | null>, origin: string) => {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  u.searchParams.set("iss", origin);
  return new Response(null, { status: 303, headers: { location: u.href, ...NO_STORE } });
};

const PAGE_HEADERS = { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "x-frame-options": "DENY", "referrer-policy": "same-origin", ...NO_STORE };
const page = (title: string, body: string, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · codeSplitters</title>
<style>
:root{--bg:#fff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--accent:#f26b1d;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#3d444d}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:440px;width:100%;border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:20px;margin:0 0 12px}.muted{color:var(--muted);font-size:13px}label{display:flex;gap:8px;align-items:baseline;margin:6px 0}
.warn{border-left:3px solid var(--accent);padding:4px 10px;margin:12px 0}
.row{display:flex;gap:8px;margin-top:18px}button,a.btn{flex:1;font:inherit;padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer;text-align:center;text-decoration:none}
button.go{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}code{font-size:13px;word-break:break-all}
</style></head><body><main>${body}</main></body></html>`, { status, headers: PAGE_HEADERS });

/** A grant's new access token (and refresh token), as the token endpoint answers. */
async function issue(env: Env, g: { id: string; name: string; client_name: string; scope: string }, refresh: string) {
  const access = random("cst_"), now = Date.now();
  await env.DB.prepare("INSERT INTO api_tokens (id, name, label, hash, last4, scope, created_at, expires_at, grant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id(), g.name, g.client_name, await hash(access), access.slice(-4), g.scope, now, now + HOUR, g.id).run();
  return json({ access_token: access, token_type: "Bearer", expires_in: HOUR / 1000, refresh_token: refresh, scope: g.scope }, 200, { ...NO_STORE, ...CORS });
}

const revokeGrant = (env: Env, grant: string) => env.DB.batch([
  env.DB.prepare("DELETE FROM api_tokens WHERE grant_id = ?").bind(grant),
  env.DB.prepare("DELETE FROM oauth_grants WHERE id = ?").bind(grant),
]);

/** Form-encoded, as OAuth sends it, or JSON. */
async function fields(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const b = await req.json().catch(() => ({}));
    return Object.fromEntries(Object.entries(b ?? {}).map(([k, v]) => [k, String(v)]));
  }
  return Object.fromEntries(new URLSearchParams(await req.text().catch(() => "")));
}

async function authorizePage(req: Request, env: Env, url: URL) {
  const q = Object.fromEntries(url.searchParams);
  const c = await client(env, q.client_id ?? "", q.redirect_uri ?? "");
  // A bad client or redirect is never redirected to: that's how codes get stolen.
  if (typeof c === "string") return page("Can't sign in", `<h1>This app can't sign in</h1><p>${esc(c)}.</p>`, 400);
  const state = q.state ?? null;
  if (q.response_type !== "code") return back(q.redirect_uri, { error: "unsupported_response_type", error_description: "only response_type=code", state }, url.origin);
  if (!q.code_challenge || q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge))
    return back(q.redirect_uri, { error: "invalid_request", error_description: "PKCE is required: code_challenge with code_challenge_method=S256", state }, url.origin);
  if (req.headers.has("authorization")) return page("Can't sign in", "<h1>Sign in here with the site, not a token</h1>", 403);
  const user = await identify(req, env);
  if (!user) return page("Sign in first", `<h1>Sign in to codeSplitters first</h1>
    <p><b>${esc(c.name)}</b> wants to sign in as you. Sign in on <a href="/" target="_blank" rel="noopener">codeSplitters</a> in this browser (and pick your handle), then come back and reload.</p>
    <div class="row"><a class="btn" href="${esc(url.pathname + url.search)}">Reload</a></div>`);
  const asked = (q.scope ?? "").split(/\s+/).includes("write") ? "write" : "read";
  const form = random("csf_");
  await env.DB.prepare("INSERT INTO oauth_requests (id, name, client_id, client_name, redirect_uri, state, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(form, user, q.client_id, c.name, q.redirect_uri, state, q.code_challenge, Date.now() + CODE_MS).run();
  const scope = (s: keyof typeof OAUTH_SCOPES) => `<label><input type="radio" name="scope" value="${s}"${s === asked ? " checked" : ""}><span><b>${s === "read" ? "Read only" : "Read and write"}</b> <span class="muted">${OAUTH_SCOPES[s]}</span></span></label>`;
  const to = new URL(q.redirect_uri);
  return page("Sign in an app", `<h1>Let <b>${esc(c.name)}</b> act as @${esc(user)}?</h1>
    ${c.local ? `<p class="warn">An app on this computer${c.registered ? "" : ", by the name it gave itself"}. Only say yes if you just started this from it.</p>` : ""}
    <p class="muted">It'll be sent back to <code>${esc(to.origin + to.pathname)}</code>. It can't reach admin pages, your tokens, your sign-in or live sockets, and you can revoke it from your profile page at any time.</p>
    <form method="post" action="/api/oauth/authorize"><input type="hidden" name="request" value="${form}">
    ${scope("read")}${scope("write")}
    <div class="row"><button name="decision" value="deny">Cancel</button><button class="go" name="decision" value="allow">Allow</button></div></form>`);
}

async function authorizeForm(req: Request, env: Env, url: URL) {
  const origin = req.headers.get("origin");
  if (req.headers.has("authorization") || (origin && origin !== url.origin)) return page("Can't sign in", "<h1>Say yes on codeSplitters itself</h1>", 403);
  const f = await fields(req);
  const user = await identify(req, env);
  const r = user && f.request ? await env.DB.prepare("SELECT * FROM oauth_requests WHERE id = ? AND name = ? AND code_hash IS NULL AND expires_at > ?").bind(f.request, user, Date.now()).first() as { id: string; redirect_uri: string; state: string | null } | null : null;
  if (!r) return page("Can't sign in", "<h1>That sign-in has expired</h1><p>Start again from the app.</p>", 400);
  if (f.decision !== "allow") {
    await env.DB.prepare("DELETE FROM oauth_requests WHERE id = ?").bind(r.id).run();
    return back(r.redirect_uri, { error: "access_denied", error_description: "you said no", state: r.state }, url.origin);
  }
  const code = random("csa_");
  await env.DB.prepare("UPDATE oauth_requests SET code_hash = ?, scope = ?, expires_at = ? WHERE id = ?")
    .bind(await hash(code), f.scope === "write" ? "write" : "read", Date.now() + CODE_MS, r.id).run();
  return back(r.redirect_uri, { code, state: r.state }, url.origin);
}

async function token(req: Request, env: Env) {
  const f = await fields(req), now = Date.now();
  if (f.grant_type === "authorization_code") {
    if (!f.code || !f.code_verifier) return oauthError("invalid_request", "code and code_verifier are required");
    const r = await env.DB.prepare("SELECT * FROM oauth_requests WHERE code_hash = ?").bind(await hash(f.code)).first() as
      { id: string; name: string; client_id: string; client_name: string; redirect_uri: string; code_challenge: string; scope: string; expires_at: number } | null;
    // Once only, right or wrong.
    if (r) await env.DB.prepare("DELETE FROM oauth_requests WHERE id = ?").bind(r.id).run();
    if (!r || r.expires_at <= now) return oauthError("invalid_grant", "that code is expired, used or wrong");
    if (f.client_id !== r.client_id || f.redirect_uri !== r.redirect_uri) return oauthError("invalid_grant", "client_id and redirect_uri must match the authorize request");
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(f.code_verifier))));
    if (challenge !== r.code_challenge) return oauthError("invalid_grant", "code_verifier doesn't match the code_challenge");
    const refresh = random("csr_");
    const g = { id: id(), name: r.name, client_name: r.client_name, scope: r.scope };
    await env.DB.prepare("INSERT INTO oauth_grants (id, name, client_id, client_name, scope, refresh_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(g.id, g.name, r.client_id, g.client_name, g.scope, await hash(refresh), now, now + REFRESH_MS, now).run();
    return issue(env, g, refresh);
  }
  if (f.grant_type === "refresh_token") {
    if (!f.refresh_token) return oauthError("invalid_request", "refresh_token is required");
    const h = await hash(f.refresh_token);
    const g = await env.DB.prepare("SELECT * FROM oauth_grants WHERE refresh_hash = ?").bind(h).first() as
      { id: string; name: string; client_id: string; client_name: string; scope: string; created_at: number; expires_at: number } | null;
    if (!g) {
      // A refresh token already swapped, shown again: someone else has it. End the grant.
      const stolen = await env.DB.prepare("SELECT id FROM oauth_grants WHERE prev_hash = ?").bind(h).first() as { id: string } | null;
      if (stolen) await revokeGrant(env, stolen.id);
      return oauthError("invalid_grant", "that refresh token is expired, revoked or wrong: sign in again");
    }
    if (g.expires_at <= now) { await revokeGrant(env, g.id); return oauthError("invalid_grant", "this sign-in has expired: sign in again"); }
    if (f.client_id && f.client_id !== g.client_id) return oauthError("invalid_grant", "that refresh token is another client's");
    const refresh = random("csr_");
    await env.DB.prepare("UPDATE oauth_grants SET refresh_hash = ?, prev_hash = ?, expires_at = ?, last_used_at = ? WHERE id = ?")
      .bind(await hash(refresh), h, Math.min(now + REFRESH_MS, g.created_at + GRANT_MS), now, g.id).run();
    return issue(env, g, refresh);
  }
  return oauthError("unsupported_grant_type", "authorization_code or refresh_token");
}

async function register(req: Request, env: Env) {
  const b = (await req.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
  const uris = b?.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 5 || !uris.every(registrable))
    return oauthError("invalid_redirect_uri", "redirect_uris: 1 to 5 https URLs, or http://127.0.0.1 / localhost ones");
  const name = (typeof b?.client_name === "string" ? b.client_name.replace(/[\x00-\x1f<>]/g, "").trim().slice(0, 60) : "") || "an app";
  const c = { client_id: random("csc_").slice(0, 28), client_name: name, redirect_uris: uris as string[], client_id_issued_at: Math.floor(Date.now() / 1000) };
  await env.DB.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)").bind(c.client_id, name, JSON.stringify(uris), Date.now()).run();
  // Public clients only: whatever auth method it asked for, it sends no secret.
  return json({ ...c, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }, 201, { ...NO_STORE, ...CORS });
}

async function revoke(req: Request, env: Env) {
  const { token: t } = await fields(req);
  if (t) {
    const h = await hash(t);
    const g = await env.DB.prepare("SELECT id FROM oauth_grants WHERE refresh_hash = ? OR prev_hash = ?").bind(h, h).first() as { id: string } | null;
    if (g) await revokeGrant(env, g.id);
    else await env.DB.prepare("DELETE FROM api_tokens WHERE hash = ?").bind(h).run();
  }
  // Known or not, the answer's the same (RFC 7009).
  return new Response(null, { status: 200, headers: { ...NO_STORE, ...CORS } });
}

/** /api/oauth/*, before tokens are looked at: the token endpoint is called without one. */
export async function oauthRoutes(req: Request, env: Env, p: string[], url: URL): Promise<Response | null> {
  if (p[1] !== "oauth") return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (p[2] === "authorize" && !p[3]) return req.method === "GET" ? authorizePage(req, env, url) : req.method === "POST" ? authorizeForm(req, env, url) : null;
  if (req.method === "POST" && !p[3]) {
    if (p[2] === "token") return token(req, env);
    if (p[2] === "register") return register(req, env);
    if (p[2] === "revoke") return revoke(req, env);
  }
  if (p[2] === "grants") {
    // Your apps, by cookie: a token can't list or end grants.
    if (req.headers.has("authorization")) return json({ error: "API tokens can't reach this: sign in on the site" }, 403);
    const user = await identify(req, env);
    if (!user) return json({ error: "sign in first" }, 401);
    if (!p[3] && req.method === "GET") {
      const { results } = await env.DB.prepare(`SELECT g.id, g.client_id, g.client_name, g.scope, g.created_at, g.expires_at,
        MAX(COALESCE((SELECT MAX(last_used_at) FROM api_tokens WHERE grant_id = g.id), 0), COALESCE(g.last_used_at, 0)) AS last_used_at
        FROM oauth_grants g WHERE g.name = ? AND g.expires_at > ? ORDER BY g.created_at DESC`).bind(user, Date.now()).all();
      return json(results);
    }
    if (p[3] && !p[4] && req.method === "DELETE") {
      const g = await env.DB.prepare("SELECT id FROM oauth_grants WHERE id = ? AND name = ?").bind(p[3], user).first() as { id: string } | null;
      if (!g) return json({ error: "no such app" }, 404);
      await revokeGrant(env, g.id);
      return json({ ok: true });
    }
  }
  return json({ error: "no such OAuth route" }, 404);
}

/** Hourly: drop stale sign-ins, expired grants and their tokens, and apps that registered but never signed in. */
export async function sweepOAuth(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_requests WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM api_tokens WHERE grant_id IS NOT NULL AND (expires_at <= ? OR grant_id NOT IN (SELECT id FROM oauth_grants WHERE expires_at > ?))").bind(now, now),
    env.DB.prepare("DELETE FROM oauth_grants WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM oauth_clients WHERE created_at <= ? AND id NOT IN (SELECT client_id FROM oauth_grants) AND id NOT IN (SELECT client_id FROM oauth_requests)").bind(now - DAY),
  ]);
}
