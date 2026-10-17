// Who is asking. Better Auth (email and password, plus GitHub and Google when their keys are
// set) answers /api/auth/*; the rest of the app sees a User or null. An API key (qk_…, made
// per org by an owner) acts as the person who made it, inside that org only.
//
// Everything is off without BETTER_AUTH_SECRET: a deploy that lost it answers 503 rather than
// letting anyone in as anyone.

import { betterAuth } from "better-auth";
import { b64url, error, json, readBody, sha256, type Env } from "./env.ts";
import type { Ctx } from "./orgs.ts";

export interface User { id: string; email: string; name: string; /** Set when the request came in on an API key: the one org it opens. */ key?: { id: string; org_id: string } }

export const accountsOn = (env: Env) => !!env.BETTER_AUTH_SECRET;
export const accountsOff = () => error(503, "accounts off");

export function providers(env: Env) {
  const out = ["email"];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) out.push("github");
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push("google");
  return out;
}

const make = (env: Env, origin: string) => betterAuth({
  // better-auth wants Cloudflare's D1Database class; Env.DB is the part of it this app calls.
  database: env.DB as never,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL ?? origin,
  basePath: "/api/auth",
  trustedOrigins: [env.BETTER_AUTH_URL ?? origin],
  emailAndPassword: { enabled: true },
  socialProviders: {
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } } : {}),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {}),
  },
});
// One instance per request, never per isolate: Better Auth's D1 queries share one connection
// mutex, and a request cancelled while holding it would hang every later sign-in in the isolate.
const auths = new WeakMap<Request, ReturnType<typeof make>>();
export function authFor(req: Request, env: Env) {
  let auth = auths.get(req);
  if (!auth) { auth = make(env, new URL(req.url).origin); auths.set(req, auth); }
  return auth;
}

const bearerOf = (req: Request) => /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;

/** Who the request's API key is, or null when it carries none; a Response for a bad key. */
async function byKey(req: Request, env: Env): Promise<User | Response | null> {
  const secret = bearerOf(req);
  if (secret === null) return null;
  // qk_ is a key an owner made; qo_ is an OAuth access token (oauth.ts), which expires.
  const k = /^q[ko]_/.test(secret) && await env.DB.prepare(`SELECT k.id, k.org_id, k.last_used_at, u.id AS user_id, u.email, u.name FROM api_keys k
    JOIN "user" u ON u.id = k.user_id WHERE k.hash = ? AND (k.expires_at IS NULL OR k.expires_at > ?)`).bind(await sha256(secret), Date.now()).first<{ id: string; org_id: string; last_used_at: number | null; user_id: string; email: string; name: string }>();
  if (!k) return json({ error: "this API key is revoked, expired or wrong" }, 401, { "www-authenticate": 'Bearer error="invalid_token"' });
  // Last used, to the minute: one write a minute at most, not one a request.
  if (!k.last_used_at || Date.now() - k.last_used_at > 60_000) await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), k.id).run();
  return { id: k.user_id, email: k.email, name: k.name, key: { id: k.id, org_id: k.org_id } };
}

/** The signed-in person: an API key first, else the session cookie. */
export async function sessionUser(req: Request, env: Env): Promise<User | Response | null> {
  if (!accountsOn(env)) return accountsOff();
  const keyed = await byKey(req, env);
  if (keyed) return keyed;
  if (!/better-auth\.session_token=/.test(req.headers.get("cookie") ?? "")) return null;
  const s = await authFor(req, env).api.getSession({ headers: req.headers });
  return s ? { id: s.user.id, email: s.user.email, name: s.user.name } : null;
}

/** The user, or the refusal to send back (401 signed out, 503 accounts off). */
export async function requireUser(req: Request, env: Env): Promise<User | Response> {
  const u = await sessionUser(req, env);
  return u ?? error(401, "sign in first");
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/**
 * A cookie-signed write from another site: refuse it. The Origin header must be ours (the request's
 * own origin or BETTER_AUTH_URL); without one, Sec-Fetch-Site says; with neither, it isn't a browser.
 * A request on an API key carries no cookie that another site could ride on.
 */
export function crossSite(req: Request, env: Env): Response | null {
  if (!UNSAFE.has(req.method) || !req.headers.get("cookie") || bearerOf(req)) return null;
  const origin = req.headers.get("origin");
  const ours = new Set([new URL(req.url).origin, ...(env.BETTER_AUTH_URL ? [new URL(env.BETTER_AUTH_URL).origin] : [])]);
  const foreign = origin ? !ours.has(origin) : req.headers.get("sec-fetch-site") === "cross-site";
  return foreign ? error(403, "cross-site request refused: send it from this site, or with Authorization: Bearer") : null;
}

/** The set-cookie lines of `headers`, joined the way a browser would send them back. */
export const cookieOf = (headers: Headers) => (headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""]).filter(Boolean).map((c) => c.split(";")[0]).join("; ");

/**
 *   GET    /api/orgs/:org/keys          the org's keys, by prefix (owner+)
 *   POST   /api/orgs/:org/keys {name}   a new key; the secret is shown this once
 *   DELETE /api/orgs/:org/keys/:id
 * Keys are made and revoked from a signed-in browser, never with another key.
 */
export async function keyRoutes({ req, env, user, org, p, audit }: Ctx): Promise<Response | null> {
  if (p[0] !== "keys") return null;
  if (user.key) return error(403, "API keys can't manage keys: sign in on the site");
  if (!p[1] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, name, prefix, user_id, created_at, last_used_at FROM api_keys WHERE org_id = ? AND grant_id IS NULL ORDER BY created_at DESC").bind(org).all();
    return json(results);
  }
  if (!p[1] && req.method === "POST") {
    const b = await readBody<{ name?: unknown }>(req);
    const name = typeof b?.name === "string" ? b.name.trim().slice(0, 80) : "";
    if (!name) return error(400, "name: what this key is for");
    const secret = "qk_" + b64url(crypto.getRandomValues(new Uint8Array(24)));
    const key = { id: crypto.randomUUID(), name, prefix: secret.slice(0, 8), created_at: Date.now() };
    await env.DB.prepare("INSERT INTO api_keys (id, org_id, user_id, name, hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(key.id, org, user.id, name, await sha256(secret), key.prefix, key.created_at).run();
    await audit("key.create", key.id, name);
    return json({ ...key, secret }, 201);
  }
  if (p[1] && !p[2] && req.method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND org_id = ? AND grant_id IS NULL").bind(p[1], org).run();
    if (!r.meta.changes) return error(404, "no such key");
    await audit("key.delete", p[1]);
    return json({ ok: true });
  }
  return null;
}
