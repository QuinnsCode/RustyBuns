// Who is asking. Two modes:
//   accounts  Better Auth (email and password, plus GitHub and Google when their
//             keys are set). On whenever BETTER_AUTH_SECRET is set. After signing
//             in, everyone picks a handle of six or more characters, for good.
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

/**
 * agent-<harness> is the collaborator a coding agent edits as (agent-routes.ts),
 * so no person may hold one, or they'd join every repo that runs that agent.
 */
export const isAgentHandle = (name: string) => name.startsWith("agent-");

/** A handle from a display name or email: "Ryan Quinn" -> "ryan-quinn", "Agent Codex" -> "agentcodex". */
export function slug(s: string) {
  const out = s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/, "").replace(/^agent-/, "agent");
  return NAME.test(out) ? out : "digger";
}

/** Handles this short are an admin's to give out (handle_grants); everyone else picks one of six or more. */
export const SHORT = 5;

type AuthUser = { id: string; name?: string; email?: string; emailVerified?: boolean };

/**
 * The handle linked to this account, or null until its owner picks one. An
 * account whose (verified) email an admin granted a handle, or ADMIN_EMAIL, gets it on first sight.
 */
async function handleFor(env: Env, u: AuthUser) {
  const linked = await env.DB.prepare("SELECT name FROM users WHERE auth_id = ?").bind(u.id).first();
  if (linked) return linked.name as string;
  // Anyone can type an email at signup, so a grant goes to a verified one (GitHub, Google).
  if (!u.email || !u.emailVerified) return null;
  const email = u.email.toLowerCase();
  // The site's owner (ADMIN_EMAIL) gets the first ADMINS handle, even a short one.
  const owner = env.ADMIN_EMAIL?.trim().toLowerCase() === email ? env.ADMINS?.split(",")[0]?.trim() : undefined;
  const granted = owner || (await env.DB.prepare("SELECT handle FROM handle_grants WHERE email = ?").bind(email).first())?.handle as string | undefined;
  if (granted) {
    // A grant also takes over a row alias mode left behind (no account), never an owned one.
    const r = await env.DB.prepare("INSERT INTO users (name, auth_id) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET auth_id = excluded.auth_id WHERE users.auth_id IS NULL").bind(granted, u.id).run();
    if (r.meta?.changes) return granted;
  }
  return null;
}

/** Why `name` can't be someone's new handle, or null when it's free. */
async function unclaimable(env: Env, name: string) {
  if (!NAME.test(name)) return "lowercase letters and digits, single dashes between";
  if (name.length <= SHORT) return `at least ${SHORT + 1} characters`;
  if (isAgentHandle(name)) return "agent- handles are for coding agents";
  if (await env.DB.prepare("SELECT 1 FROM users WHERE name = ?").bind(name).first()) return "taken";
  if (await env.DB.prepare("SELECT 1 FROM handle_grants WHERE handle = ?").bind(name).first()) return "taken";
  return null;
}

/** A free handle to offer, from the account's name or email. */
async function suggest(env: Env, u: AuthUser) {
  let base = slug(u.name?.trim() || u.email?.split("@")[0] || "digger");
  if (base.length <= SHORT) base = slug(`${base}-digger`);   // "agent" -> "agentdigger"
  for (let n = 1; n < 50; n++) {
    const name = n === 1 ? base : `${base.slice(0, 35)}-${n}`;
    if (!(await unclaimable(env, name))) return name;
  }
  return "";
}

/** The signed-in account behind a request (accounts mode), with its handle if it has one. */
async function account(req: Request, env: Env) {
  const session = await authFor(env, new URL(req.url).origin).api.getSession({ headers: req.headers });
  return session ? { user: session.user as AuthUser, handle: await handleFor(env, session.user) } : null;
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
  return (await account(req, env))?.handle ?? null;
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
  if (isAgentHandle(b.handle!)) return json({ error: "agent- handles are for coding agents" }, 400);
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return json({ error: "give an email" }, 400);
  if (await env.DB.prepare("SELECT 1 FROM users WHERE name = ?").bind(b.handle).first()) return json({ error: `${b.handle} is taken` }, 409);
  await env.DB.prepare("INSERT OR REPLACE INTO handle_grants (handle, email) VALUES (?, ?)").bind(b.handle, email).run();
  return json({ handle: b.handle, email }, 201);
}

/**
 * GET  /api/handle?name=  is it free? {name, ok, why}
 * POST /api/handle {name}  claim it: once per account, six or more characters, for good.
 */
async function handleRoutes(req: Request, env: Env, url: URL) {
  if (req.method === "GET") {
    const name = url.searchParams.get("name") ?? "";
    const why = await unclaimable(env, name);
    return json({ name, ok: !why, why });
  }
  if (req.method !== "POST") return null;
  const a = await account(req, env);
  if (!a) return json({ error: "sign in first" }, 401);
  if (a.handle) return json({ error: `you're already @${a.handle}` }, 409);
  const { name = "" } = (await req.json().catch(() => ({}))) as { name?: string };
  const why = await unclaimable(env, name);
  if (why) return json({ error: `@${name}: ${why}` }, why === "taken" ? 409 : 400);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO users (name, auth_id) VALUES (?, ?)").bind(name, a.user.id).run();
  if (!r.meta?.changes) return json({ error: `@${name}: taken` }, 409);
  return json({ name }, 201);
}

/** /api/session, /api/login and /api/logout (alias mode), and /api/auth/* (Better Auth). */
export async function identityRoutes(req: Request, env: Env, p: string[]): Promise<Response | null> {
  const grants = await grantRoutes(req, env, p);
  if (grants) return grants;
  if (p[1] === "auth") return accountsOn(env) ? authFor(env, new URL(req.url).origin).handler(req) : json({ error: "accounts are off; this app uses aliases" }, 404);
  if (p[1] === "session") {
    if (!accountsOn(env)) return json({ mode: "alias", user: aliasOf(req), providers: [] });
    // Signed in but no handle yet: the page asks for one, with a free one to start from.
    const a = await account(req, env);
    const user = a?.handle ?? null;
    return json({ mode: "accounts", user, providers: providers(env), ...(isAdmin(env, user) ? { admin: true } : {}),
      ...(a && !a.handle ? { pick: { suggest: await suggest(env, a.user), email: a.user.email } } : {}) });
  }
  if (accountsOn(env) && p[1] === "handle") return handleRoutes(req, env, new URL(req.url));
  if (accountsOn(env)) return p[1] === "login" ? json({ error: "sign in with an account" }, 404) : null;
  if (p[1] === "login" && req.method === "POST") {
    const { name } = (await req.json()) as { name: string };
    if (!NAME.test(name ?? "")) return json({ error: "name: lowercase letters and digits, single dashes between" }, 400);
    if (isAgentHandle(name)) return json({ error: "agent- handles are for coding agents" }, 400);
    await env.DB.prepare("INSERT OR IGNORE INTO users (name) VALUES (?)").bind(name).run();
    return json({ name }, 200, { "set-cookie": `cs_user=${name}; Path=/; SameSite=Lax` });
  }
  if (p[1] === "logout" && req.method === "POST") return json({ ok: true }, 200, { "set-cookie": "cs_user=; Path=/; Max-Age=0; SameSite=Lax" });
  return null;
}
