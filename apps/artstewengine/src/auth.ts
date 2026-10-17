// The admin account. Better Auth (email and password) on D1, but /api/auth is never mounted: the only
// way in is the two forms in handle.ts, and a hook refuses any email but ADMIN_EMAIL, so there is
// nothing for a stranger to sign up to.
import { betterAuth } from "better-auth";
import type { Env } from "./env.ts";

export interface Admin { id: string; email: string }

export const authOn = (conf: Env) => !!conf.BETTER_AUTH_SECRET && !!conf.ADMIN_EMAIL;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const make = (conf: Env, origin: string) => betterAuth({
  database: conf.DB as never,
  secret: conf.BETTER_AUTH_SECRET,
  baseURL: conf.BETTER_AUTH_URL ?? origin,
  basePath: "/api/auth",
  trustedOrigins: [conf.BETTER_AUTH_URL ?? origin],
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  databaseHooks: { user: { create: { before: async (user) => {
    if (!conf.ADMIN_EMAIL || !same(user.email, conf.ADMIN_EMAIL)) throw new Error("not the admin");
  } } } },
});

// One instance per request: Better Auth's D1 queries share a connection mutex (same reason as qCRM).
const auths = new WeakMap<Request, ReturnType<typeof make>>();
export function authFor(req: Request, conf: Env) {
  let auth = auths.get(req);
  if (!auth) { auth = make(conf, new URL(req.url).origin); auths.set(req, auth); }
  return auth;
}

/** The signed-in admin, or null. */
export async function adminOf(req: Request, conf: Env): Promise<Admin | null> {
  if (!authOn(conf) || !/better-auth\.session_token=/.test(req.headers.get("cookie") ?? "")) return null;
  const s = await authFor(req, conf).api.getSession({ headers: req.headers });
  return s && same(s.user.email, conf.ADMIN_EMAIL!) ? { id: s.user.id, email: s.user.email } : null;
}

/** No account yet: the login page offers to make the admin's. */
export async function needsSetup(conf: Env): Promise<boolean> {
  return !(await conf.DB.prepare('SELECT 1 AS n FROM "user" LIMIT 1').first());
}

export const sameEmail = same;
