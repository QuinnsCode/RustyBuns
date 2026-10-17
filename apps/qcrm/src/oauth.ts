// OAuth sign-in for MCP clients (Claude's desktop app, Claude Code): the client opens a qCRM page,
// the person picks an org and says yes, and the client gets tokens without anyone copying a key.
// OAuth 2.1's authorization code flow with PKCE, public clients only; the shape follows codeSplitter's.
//
//   - An access token (qo_…) is an API key an hour long (api_keys, grant_id set): it acts as the person
//     inside the one org they picked, and is refused the same things a key is (keys, orgs, the account).
//   - A refresh token lasts 30 days from its last use, a grant a year at most. It rotates on every use;
//     an old one shown again means it leaked, and the grant goes.
//   - A code works once, for 10 minutes, for the client, redirect and PKCE verifier (S256) it was made for.
//   - An app on this computer (a loopback redirect, any port) needn't register; anything else registers
//     first (POST /api/oauth/register) and may only send the person back to an https URL it gave then.
//   - The consent form takes the cookie, never a key, from this site only, and can't be framed.
//   - Grants list under GET /api/oauth/grants (cookie only); deleting one deletes its tokens at once.
//
//   GET  /.well-known/oauth-authorization-server   RFC 8414 metadata
//   GET  /.well-known/oauth-protected-resource[/…]  RFC 9728, for MCP clients
//   GET  /api/oauth/authorize   the consent page      POST: its form
//   POST /api/oauth/token       authorization_code | refresh_token
//   POST /api/oauth/register    RFC 7591 {redirect_uris, client_name?}
//   POST /api/oauth/revoke      RFC 7009 {token}
//   GET  /api/oauth/grants      DELETE /api/oauth/grants/:id

import { sessionUser } from "./auth.ts";
import { b64url, digest, error, json, NAME, parseJson, readBody, sha256, type Env } from "./env.ts";
import { listOrgs } from "./orgs.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR, CODE_MS = 10 * 60_000, REFRESH_MS = 30 * DAY, GRANT_MS = 365 * DAY;

const random = (prefix: string) => prefix + b64url(crypto.getRandomValues(new Uint8Array(32)));
const NO_STORE = { "cache-control": "no-store" };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS" };
const oauthError = (e: string, description: string, status = 400) => json({ error: e, error_description: description }, status, { ...NO_STORE, ...CORS });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The metadata MCP clients find the endpoints by. The issuer is the site. */
export const metadata = (origin: string) => ({
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
});

/** GET /.well-known/…: null when it's none of ours. */
export function wellKnown(req: Request, p: string[], origin: string): Response | null {
  if (p[0] !== ".well-known") return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return null;
  if (p[1] === "oauth-authorization-server" || p[1] === "openid-configuration") return json(metadata(origin), 200, CORS);
  if (p[1] === "oauth-protected-resource") {
    // The suffix names the resource (/api/mcp); bare, it's the whole API.
    const resource = p.length > 2 ? `${origin}/${p.slice(2).join("/")}` : `${origin}/api`;
    return json({ resource, authorization_servers: [origin], bearer_methods_supported: ["header"], resource_name: NAME }, 200, CORS);
  }
  return null;
}

const parse = (s: string) => { try { return new URL(s); } catch { return null; } };
const loopback = (u: URL) => u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);

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
async function client(env: Env, clientId: string, redirectUri: string): Promise<{ name: string; local: boolean } | string> {
  const redirect = parse(redirectUri);
  if (!clientId || clientId.length > 80 || /[\x00-\x1f<>]/.test(clientId)) return "client_id is missing or odd";
  if (!redirect || redirect.hash) return "redirect_uri is missing or not a URL";
  if (clientId.startsWith("qc_")) {
    const c = await env.DB.prepare("SELECT name, redirect_uris FROM oauth_clients WHERE id = ?").bind(clientId).first<{ name: string; redirect_uris: string }>();
    if (!c) return "no such client: register again";
    if (!parseJson<string[]>(c.redirect_uris, []).some((r) => sameRedirect(r, redirectUri))) return "that redirect_uri isn't one this client registered";
    return { name: c.name, local: loopback(redirect) };
  }
  // Unregistered: only an app on this computer, named by itself.
  if (!loopback(redirect)) return "an unregistered client may only redirect to this computer (http://127.0.0.1 or localhost): register at /api/oauth/register";
  return { name: clientId, local: true };
}

/** Back to the app with these, as a 303 (the form's POST becomes its GET). */
const back = (redirectUri: string, params: Record<string, string | null>, origin: string) => {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  u.searchParams.set("iss", origin);
  return new Response(null, { status: 303, headers: { location: u.href, ...NO_STORE } });
};

const page = (title: string, body: string, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${NAME}</title>
<style>
:root{--bg:#f6f1e7;--fg:#14213d;--muted:#5b6577;--line:#d8d0bf;--accent:#2b7fd1;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0b0710;--fg:#f1ead8;--muted:#a79fb5;--line:#2c2338}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:440px;width:100%;border:1px solid var(--line);border-radius:8px;padding:24px}
h1{font-size:20px;margin:0 0 12px}.muted{color:var(--muted);font-size:13px}label{display:flex;gap:8px;align-items:baseline;margin:6px 0}
.warn{border-left:3px solid var(--accent);padding:4px 10px;margin:12px 0}
.row{display:flex;gap:8px;margin-top:18px}button,a.btn{flex:1;font:inherit;padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer;text-align:center;text-decoration:none}
button.go{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}code{font-size:13px;word-break:break-all}
</style></head><body><main>${body}</main></body></html>`, {
  status,
  headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "x-frame-options": "DENY", "referrer-policy": "same-origin", ...NO_STORE },
});

/** A grant's new access token (and refresh token), as the token endpoint answers. */
async function issue(env: Env, g: { id: string; user_id: string; org_id: string; client_name: string }, refresh: string) {
  const access = random("qo_"), now = Date.now();
  await env.DB.prepare("INSERT INTO api_keys (id, org_id, user_id, name, hash, prefix, created_at, expires_at, grant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), g.org_id, g.user_id, g.client_name, await sha256(access), access.slice(0, 8), now, now + HOUR, g.id).run();
  return json({ access_token: access, token_type: "Bearer", expires_in: HOUR / 1000, refresh_token: refresh }, 200, { ...NO_STORE, ...CORS });
}

const revokeGrant = (env: Env, grant: string) => env.DB.batch([
  env.DB.prepare("DELETE FROM api_keys WHERE grant_id = ?").bind(grant),
  env.DB.prepare("DELETE FROM oauth_grants WHERE id = ?").bind(grant),
]);

/** Form-encoded, as OAuth sends it, or JSON. */
async function fields(req: Request): Promise<Record<string, string>> {
  if ((req.headers.get("content-type") ?? "").includes("application/json"))
    return Object.fromEntries(Object.entries((await readBody(req)) ?? {}).map(([k, v]) => [k, String(v)]));
  return Object.fromEntries(new URLSearchParams(await req.text().catch(() => "")));
}

/** The signed-in person by cookie. A key never opens this page. */
async function cookieUser(req: Request, env: Env) {
  if (req.headers.has("authorization")) return null;
  const u = await sessionUser(req, env);
  return u instanceof Response ? null : u;
}

async function authorizePage(req: Request, env: Env, url: URL, origin: string) {
  const q = Object.fromEntries(url.searchParams);
  const c = await client(env, q.client_id ?? "", q.redirect_uri ?? "");
  // A bad client or redirect is never redirected to: that's how codes get stolen.
  if (typeof c === "string") return page("Can't sign in", `<h1>This app can't sign in</h1><p>${esc(c)}.</p>`, 400);
  const state = q.state ?? null;
  if (q.response_type !== "code") return back(q.redirect_uri!, { error: "unsupported_response_type", error_description: "only response_type=code", state }, origin);
  if (!q.code_challenge || q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge))
    return back(q.redirect_uri!, { error: "invalid_request", error_description: "PKCE is required: code_challenge with code_challenge_method=S256", state }, origin);
  if (req.headers.has("authorization")) return page("Can't sign in", "<h1>Sign in here with the site, not a key</h1>", 403);
  const user = await cookieUser(req, env);
  if (!user) return page("Sign in first", `<h1>Sign in to ${NAME} first</h1>
    <p><b>${esc(c.name)}</b> wants to sign in as you. Sign in on <a href="/app" target="_blank" rel="noopener">${NAME}</a> in this browser, then come back and reload.</p>
    <div class="row"><a class="btn" href="${esc(url.pathname + url.search)}">Reload</a></div>`);
  const orgs = await listOrgs(env, user);
  if (!orgs.length) return page("No org", "<h1>You have no org to share</h1><p>Open the app once to make yours, then reload.</p>", 400);
  const form = random("qf_");
  await env.DB.prepare("INSERT INTO oauth_requests (id, user_id, client_id, client_name, redirect_uri, state, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(form, user.id, q.client_id, c.name, q.redirect_uri, state, q.code_challenge, Date.now() + CODE_MS).run();
  const to = new URL(q.redirect_uri!);
  return page("Sign in an app", `<h1>Let <b>${esc(c.name)}</b> act as you?</h1>
    ${c.local ? `<p class="warn">An app on this computer. Only say yes if you just started this from it.</p>` : ""}
    <p class="muted">It'll be sent back to <code>${esc(to.origin + to.pathname)}</code>. It gets one org, with your role in it: it can read and change that org's rows, but can't make keys or orgs or touch your account. You can end it any time under Settings.</p>
    <form method="post" action="/api/oauth/authorize"><input type="hidden" name="request" value="${form}">
    ${orgs.map((o, i) => `<label><input type="radio" name="org" value="${esc(o.id)}"${i ? "" : " checked"}><span><b>${esc(o.name)}</b> <span class="muted">${esc(o.role)}</span></span></label>`).join("")}
    <div class="row"><button name="decision" value="deny">Cancel</button><button class="go" name="decision" value="allow">Allow</button></div></form>`);
}

async function authorizeForm(req: Request, env: Env, url: URL, origin: string) {
  // Our own form only: a cookie plus a foreign (or missing) Origin is someone else's page.
  const from = req.headers.get("origin");
  if (req.headers.has("authorization") || !from || ![url.origin, origin].includes(from)) return page("Can't sign in", `<h1>Say yes on ${NAME} itself</h1>`, 403);
  const f = await fields(req);
  const user = await cookieUser(req, env);
  const r = user && f.request ? await env.DB.prepare("SELECT id, redirect_uri, state FROM oauth_requests WHERE id = ? AND user_id = ? AND code_hash IS NULL AND expires_at > ?")
    .bind(f.request, user.id, Date.now()).first<{ id: string; redirect_uri: string; state: string | null }>() : null;
  if (!user || !r) return page("Can't sign in", "<h1>That sign-in has expired</h1><p>Start again from the app.</p>", 400);
  if (f.decision !== "allow") {
    await env.DB.prepare("DELETE FROM oauth_requests WHERE id = ?").bind(r.id).run();
    return back(r.redirect_uri, { error: "access_denied", error_description: "you said no", state: r.state }, origin);
  }
  // Only an org they are in.
  const org = (await listOrgs(env, user)).find((o) => o.id === f.org);
  if (!org) return page("Can't sign in", "<h1>Pick one of your orgs</h1><p>Start again from the app.</p>", 400);
  const code = random("qa_");
  await env.DB.prepare("UPDATE oauth_requests SET code_hash = ?, org_id = ?, expires_at = ? WHERE id = ?").bind(await sha256(code), org.id, Date.now() + CODE_MS, r.id).run();
  return back(r.redirect_uri, { code, state: r.state }, origin);
}

type GrantRow = { id: string; user_id: string; org_id: string; client_id: string; client_name: string; created_at: number; expires_at: number };

async function token(req: Request, env: Env) {
  const f = await fields(req), now = Date.now();
  if (f.grant_type === "authorization_code") {
    if (!f.code || !f.code_verifier) return oauthError("invalid_request", "code and code_verifier are required");
    const r = await env.DB.prepare("SELECT * FROM oauth_requests WHERE code_hash = ?").bind(await sha256(f.code))
      .first<{ id: string; user_id: string; org_id: string; client_id: string; client_name: string; redirect_uri: string; code_challenge: string; expires_at: number }>();
    // Once only, right or wrong.
    if (r) await env.DB.prepare("DELETE FROM oauth_requests WHERE id = ?").bind(r.id).run();
    if (!r || r.expires_at <= now) return oauthError("invalid_grant", "that code is expired, used or wrong");
    if (f.client_id !== r.client_id || f.redirect_uri !== r.redirect_uri) return oauthError("invalid_grant", "client_id and redirect_uri must match the authorize request");
    if (b64url(await digest(f.code_verifier)) !== r.code_challenge) return oauthError("invalid_grant", "code_verifier doesn't match the code_challenge");
    const refresh = random("qr_");
    const g = { id: crypto.randomUUID(), user_id: r.user_id, org_id: r.org_id, client_name: r.client_name };
    await env.DB.prepare("INSERT INTO oauth_grants (id, user_id, org_id, client_id, client_name, refresh_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(g.id, g.user_id, g.org_id, r.client_id, g.client_name, await sha256(refresh), now, now + REFRESH_MS, now).run();
    return issue(env, g, refresh);
  }
  if (f.grant_type === "refresh_token") {
    if (!f.refresh_token) return oauthError("invalid_request", "refresh_token is required");
    const h = await sha256(f.refresh_token);
    const g = await env.DB.prepare("SELECT * FROM oauth_grants WHERE refresh_hash = ?").bind(h).first<GrantRow>();
    if (!g) {
      // A refresh token already swapped, shown again: someone else has it. End the grant.
      const stolen = await env.DB.prepare("SELECT id FROM oauth_grants WHERE prev_hash = ?").bind(h).first<{ id: string }>();
      if (stolen) await revokeGrant(env, stolen.id);
      return oauthError("invalid_grant", "that refresh token is expired, revoked or wrong: sign in again");
    }
    if (g.expires_at <= now) { await revokeGrant(env, g.id); return oauthError("invalid_grant", "this sign-in has expired: sign in again"); }
    if (f.client_id && f.client_id !== g.client_id) return oauthError("invalid_grant", "that refresh token is another client's");
    const refresh = random("qr_");
    await env.DB.prepare("UPDATE oauth_grants SET refresh_hash = ?, prev_hash = ?, expires_at = ?, last_used_at = ? WHERE id = ?")
      .bind(await sha256(refresh), h, Math.min(now + REFRESH_MS, g.created_at + GRANT_MS), now, g.id).run();
    return issue(env, g, refresh);
  }
  return oauthError("unsupported_grant_type", "authorization_code or refresh_token");
}

async function register(req: Request, env: Env) {
  const b = (await readBody<{ redirect_uris?: unknown; client_name?: unknown }>(req)) ?? {};
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 5 || !uris.every(registrable))
    return oauthError("invalid_redirect_uri", "redirect_uris: 1 to 5 https URLs, or http://127.0.0.1 / localhost ones");
  const name = (typeof b.client_name === "string" ? b.client_name.replace(/[\x00-\x1f<>]/g, "").trim().slice(0, 60) : "") || "an app";
  const c = { client_id: random("qc_").slice(0, 28), client_name: name, redirect_uris: uris as string[], client_id_issued_at: Math.floor(Date.now() / 1000) };
  await env.DB.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)").bind(c.client_id, name, JSON.stringify(uris), Date.now()).run();
  // Public clients only: whatever auth method it asked for, it sends no secret.
  return json({ ...c, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }, 201, { ...NO_STORE, ...CORS });
}

async function revoke(req: Request, env: Env) {
  const { token: t } = await fields(req);
  if (t) {
    const h = await sha256(t);
    const g = await env.DB.prepare("SELECT id FROM oauth_grants WHERE refresh_hash = ? OR prev_hash = ?").bind(h, h).first<{ id: string }>();
    if (g) await revokeGrant(env, g.id);
    else await env.DB.prepare("DELETE FROM api_keys WHERE hash = ? AND grant_id IS NOT NULL").bind(h).run();
  }
  // Known or not, the answer's the same (RFC 7009).
  return new Response(null, { status: 200, headers: { ...NO_STORE, ...CORS } });
}

/** /api/oauth/*, before anyone is looked up: the token endpoint is called without a key. */
export async function oauthRoutes(req: Request, env: Env, p: string[], url: URL, origin: string): Promise<Response | null> {
  if (p[1] !== "oauth") return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (p[2] === "authorize" && !p[3]) return req.method === "GET" ? authorizePage(req, env, url, origin) : req.method === "POST" ? authorizeForm(req, env, url, origin) : null;
  if (req.method === "POST" && !p[3]) {
    if (p[2] === "token") return token(req, env);
    if (p[2] === "register") return register(req, env);
    if (p[2] === "revoke") return revoke(req, env);
  }
  if (p[2] === "grants") {
    // Your apps, by cookie: a key can't list or end grants.
    if (req.headers.has("authorization")) return error(403, "API keys can't reach this: sign in on the site");
    const user = await cookieUser(req, env);
    if (!user) return error(401, "sign in first");
    if (!p[3] && req.method === "GET") {
      const { results } = await env.DB.prepare(`SELECT g.id, g.org_id, g.client_name, g.created_at, g.expires_at,
        MAX(COALESCE((SELECT MAX(last_used_at) FROM api_keys WHERE grant_id = g.id), 0), COALESCE(g.last_used_at, 0)) AS last_used_at
        FROM oauth_grants g WHERE g.user_id = ? AND g.expires_at > ? ORDER BY g.created_at DESC`).bind(user.id, Date.now()).all();
      return json(results);
    }
    if (p[3] && !p[4] && req.method === "DELETE") {
      const g = await env.DB.prepare("SELECT id FROM oauth_grants WHERE id = ? AND user_id = ?").bind(p[3], user.id).first<{ id: string }>();
      if (!g) return error(404, "no such app");
      await revokeGrant(env, g.id);
      return json({ ok: true });
    }
  }
  return error(404, "no such OAuth route");
}

/** Hourly: drop stale sign-ins, expired or orphaned grants and their tokens, and apps that registered but never signed in. */
export async function sweepOAuth(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_requests WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM oauth_grants WHERE expires_at <= ? OR org_id NOT IN (SELECT id FROM orgs) OR user_id NOT IN (SELECT id FROM \"user\")").bind(now),
    env.DB.prepare("DELETE FROM api_keys WHERE grant_id IS NOT NULL AND (expires_at <= ? OR grant_id NOT IN (SELECT id FROM oauth_grants))").bind(now),
    env.DB.prepare("DELETE FROM oauth_clients WHERE created_at <= ? AND id NOT IN (SELECT client_id FROM oauth_grants) AND id NOT IN (SELECT client_id FROM oauth_requests)").bind(now - DAY),
  ]);
}
