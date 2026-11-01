// Who is signed in here. Better Auth on D1: email and password for anyone, plus GitHub, Google and Apple when
// their keys are set. Every app's people are the same accounts; apps.ts and members.ts say who came from where.
import { betterAuth } from "better-auth";
import type { Env } from "./env.ts";

export interface Me { id: string; email: string; name: string }

export const authOn = (conf: Env) => !!conf.BETTER_AUTH_SECRET;

/** iPhone, iPad and Mac browsers (an iOS app's sign-in sheet is one), where Sign in with Apple is Face ID or Touch ID. */
export const onApple = (userAgent: string | null) => /iPhone|iPad|iPod|Macintosh/.test(userAgent ?? "");

/** The sign-in buttons whose keys are set; on an Apple device Apple's goes first. */
export function providers(conf: Env, appleFirst = false) {
  const out: ("github" | "google" | "apple")[] = [];
  if (conf.APPLE_CLIENT_ID && conf.APPLE_CLIENT_SECRET && appleFirst) out.push("apple");
  if (conf.GITHUB_CLIENT_ID && conf.GITHUB_CLIENT_SECRET) out.push("github");
  if (conf.GOOGLE_CLIENT_ID && conf.GOOGLE_CLIENT_SECRET) out.push("google");
  if (conf.APPLE_CLIENT_ID && conf.APPLE_CLIENT_SECRET && !appleFirst) out.push("apple");
  return out;
}

const make = (conf: Env, origin: string) => betterAuth({
  // better-auth wants Cloudflare's D1Database class; Env.DB is the part of it this app calls.
  database: conf.DB as never,
  secret: conf.BETTER_AUTH_SECRET,
  baseURL: conf.BETTER_AUTH_URL ?? origin,
  basePath: "/api/auth",
  // Apple posts its callback from its own origin.
  trustedOrigins: [conf.BETTER_AUTH_URL ?? origin, "https://appleid.apple.com"],
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  // Its own cookie name: the QNTBR site's session cookie is set on all of .qntbr.com under Better Auth's default one,
  // and would ride along to eqosys.qntbr.com beside ours.
  advanced: { cookiePrefix: "eqosys" },
  socialProviders: {
    ...(conf.GITHUB_CLIENT_ID && conf.GITHUB_CLIENT_SECRET ? { github: { clientId: conf.GITHUB_CLIENT_ID, clientSecret: conf.GITHUB_CLIENT_SECRET } } : {}),
    ...(conf.GOOGLE_CLIENT_ID && conf.GOOGLE_CLIENT_SECRET ? { google: { clientId: conf.GOOGLE_CLIENT_ID, clientSecret: conf.GOOGLE_CLIENT_SECRET } } : {}),
    ...(conf.APPLE_CLIENT_ID && conf.APPLE_CLIENT_SECRET ? { apple: { clientId: conf.APPLE_CLIENT_ID, clientSecret: conf.APPLE_CLIENT_SECRET, ...(conf.APPLE_APP_BUNDLE_ID ? { appBundleIdentifier: conf.APPLE_APP_BUNDLE_ID } : {}) } } : {}),
  },
});

// One instance per request: Better Auth's D1 queries share a connection mutex (same reason as qCRM).
const auths = new WeakMap<Request, ReturnType<typeof make>>();
export function authFor(req: Request, conf: Env) {
  let auth = auths.get(req);
  if (!auth) { auth = make(conf, new URL(req.url).origin); auths.set(req, auth); }
  return auth;
}

/** The signed-in person, or null. */
export async function meOf(req: Request, conf: Env): Promise<Me | null> {
  if (!authOn(conf) || !/eqosys\.session_token=/.test(req.headers.get("cookie") ?? "")) return null;
  const s = await authFor(req, conf).api.getSession({ headers: req.headers });
  return s ? { id: s.user.id, email: s.user.email, name: s.user.name } : null;
}

export const isAdmin = (me: Me | null, conf: Env) =>
  !!me && !!conf.SUPER_ADMIN_EMAIL && me.email.trim().toLowerCase() === conf.SUPER_ADMIN_EMAIL.trim().toLowerCase();
