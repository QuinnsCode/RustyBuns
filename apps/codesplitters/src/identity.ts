// Who is asking. Two modes:
//   accounts  Better Auth (email and password, plus GitHub and Google when their
//             keys are set). On whenever BETTER_AUTH_SECRET is set.
//   alias     a name in a cookie, no password. The desktop app (one person on
//             their own machine), tests and demos.
// Either way the rest of the app sees one thing: a handle (users.name) or null.

import { betterAuth } from "better-auth";
import { json, NAME, type Env } from "./env.ts";

export const accountsOn = (env: Env) => !!env.BETTER_AUTH_SECRET;

export function providers(env: Env) {
  const out = ["email"];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) out.push("github");
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push("google");
  return out;
}

const make = (env: Env, origin: string) => betterAuth({
  database: env.DB,
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
// One instance per env (per isolate on Cloudflare), made on first use.
const auths = new WeakMap<object, ReturnType<typeof make>>();
function authFor(env: Env, origin: string) {
  let auth = auths.get(env);
  if (!auth) { auth = make(env, origin); auths.set(env, auth); }
  return auth;
}

const aliasOf = (req: Request) => /(?:^|;\s*)cs_user=([a-z0-9-]+)/.exec(req.headers.get("cookie") ?? "")?.[1] ?? null;

/** A handle from a display name or email: "Ryan Quinn" -> "ryan-quinn". */
export function slug(s: string) {
  const out = s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/, "");
  return NAME.test(out) ? out : "digger";
}

/** Handles this short are an admin's to give out (handle_grants), never made at signup. */
export const SHORT = 5;

/**
 * The handle linked to this account, made on first sight: one granted to its
 * (verified) email, else its name, else its email, lengthened if short and
 * numbered if taken.
 */
async function handleFor(env: Env, u: { id: string; name?: string; email?: string; emailVerified?: boolean }) {
  const linked = await env.DB.prepare("SELECT name FROM users WHERE auth_id = ?").bind(u.id).first();
  if (linked) return linked.name as string;
  // Anyone can type an email at signup, so a grant goes to a verified one (GitHub, Google).
  const granted = u.email && u.emailVerified ? await env.DB.prepare("SELECT handle FROM handle_grants WHERE email = ?").bind(u.email.toLowerCase()).first() : null;
  if (granted) {
    const r = await env.DB.prepare("INSERT OR IGNORE INTO users (name, auth_id) VALUES (?, ?)").bind(granted.handle, u.id).run();
    if (r.meta?.changes) return granted.handle as string;
  }
  let base = slug(u.name?.trim() || u.email?.split("@")[0] || "digger");
  if (base.length <= SHORT) base = `${base}-digger`;
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? base : `${base.slice(0, 35)}-${n}`;
    if (await env.DB.prepare("SELECT 1 FROM handle_grants WHERE handle = ?").bind(name).first()) continue;   // promised to someone
    const r = await env.DB.prepare("INSERT OR IGNORE INTO users (name, auth_id) VALUES (?, ?)").bind(name, u.id).run();
    if (r.meta?.changes) return name;
    // Lost a race to our own other request? Then the link exists now.
    const again = await env.DB.prepare("SELECT name FROM users WHERE auth_id = ?").bind(u.id).first();
    if (again) return again.name as string;
  }
  throw new Error("no free handle");
}

/**
 * Requests the Worker makes to itself for a hosted agent, and who each acts as.
 * Only code in this isolate holds the Request objects, so nothing outside can claim one.
 */
export const actingAs = new WeakMap<Request, string>();

export async function identify(req: Request, env: Env): Promise<string | null> {
  const inner = actingAs.get(req);
  if (inner !== undefined) return inner;
  if (!accountsOn(env)) return aliasOf(req);
  const session = await authFor(env, new URL(req.url).origin).api.getSession({ headers: req.headers });
  return session ? handleFor(env, session.user) : null;
}

/** Admins import levels: ADMINS when set, else anyone in alias mode (your own desktop). */
export function isAdmin(env: Env, user: string | null) {
  if (!user) return false;
  if (env.ADMINS) return env.ADMINS.split(",").map((s) => s.trim()).includes(user);
  return !accountsOn(env);
}

/**
 * GET|POST /api/admin/handles {handle, email}  give a handle (short ones are only
 * given this way) to whoever signs in with that email. Admins only.
 */
async function grantRoutes(req: Request, env: Env, p: string[]): Promise<Response | null> {
  if (p[1] !== "admin" || p[2] !== "handles") return null;
  if (!isAdmin(env, await identify(req, env))) return json({ error: "admins only" }, 403);
  if (req.method === "GET") return json((await env.DB.prepare("SELECT handle, email FROM handle_grants ORDER BY handle").all()).results);
  if (req.method !== "POST") return null;
  const b = (await req.json().catch(() => ({}))) as { handle?: string; email?: string };
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!NAME.test(b.handle ?? "")) return json({ error: "handle: lowercase letters and digits, single dashes between" }, 400);
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return json({ error: "give an email" }, 400);
  if (await env.DB.prepare("SELECT 1 FROM users WHERE name = ?").bind(b.handle).first()) return json({ error: `${b.handle} is taken` }, 409);
  await env.DB.prepare("INSERT OR REPLACE INTO handle_grants (handle, email) VALUES (?, ?)").bind(b.handle, email).run();
  return json({ handle: b.handle, email }, 201);
}

/** /api/session, /api/login and /api/logout (alias mode), and /api/auth/* (Better Auth). */
export async function identityRoutes(req: Request, env: Env, p: string[]): Promise<Response | null> {
  const grants = await grantRoutes(req, env, p);
  if (grants) return grants;
  if (p[1] === "auth") return accountsOn(env) ? authFor(env, new URL(req.url).origin).handler(req) : json({ error: "accounts are off; this app uses aliases" }, 404);
  if (p[1] === "session") return json({ mode: accountsOn(env) ? "accounts" : "alias", user: await identify(req, env), providers: accountsOn(env) ? providers(env) : [] });
  if (accountsOn(env)) return p[1] === "login" ? json({ error: "sign in with an account" }, 404) : null;
  if (p[1] === "login" && req.method === "POST") {
    const { name } = (await req.json()) as { name: string };
    if (!NAME.test(name ?? "")) return json({ error: "name: lowercase letters and digits, single dashes between" }, 400);
    await env.DB.prepare("INSERT OR IGNORE INTO users (name) VALUES (?)").bind(name).run();
    return json({ name }, 200, { "set-cookie": `cs_user=${name}; Path=/; SameSite=Lax` });
  }
  if (p[1] === "logout" && req.method === "POST") return json({ ok: true }, 200, { "set-cookie": "cs_user=; Path=/; Max-Age=0; SameSite=Lax" });
  return null;
}
