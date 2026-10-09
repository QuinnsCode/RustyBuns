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

/** The handle linked to this account, made on first sight: its name, else its email, numbered if taken. */
async function handleFor(env: Env, u: { id: string; name?: string; email?: string }) {
  const linked = await env.DB.prepare("SELECT name FROM users WHERE auth_id = ?").bind(u.id).first();
  if (linked) return linked.name as string;
  const base = slug(u.name?.trim() || u.email?.split("@")[0] || "digger");
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? base : `${base.slice(0, 35)}-${n}`;
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

/** /api/session, /api/login and /api/logout (alias mode), and /api/auth/* (Better Auth). */
export async function identityRoutes(req: Request, env: Env, p: string[]): Promise<Response | null> {
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
