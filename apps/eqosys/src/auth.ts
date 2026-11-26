// Who is signed in here. Better Auth on D1: email and password for anyone, plus GitHub, Google and Apple when
// their keys are set. Every app's people are the same accounts; apps.ts and members.ts say who came from where.
import { betterAuth } from "better-auth";
import { symmetricDecrypt } from "better-auth/crypto";
import type { Env } from "./env.ts";
import { ssoPlugin, ssoRequired } from "./sso.ts";

/** The social mark cookie for an ask carried as a query (sso.ts): handle.ts is loaded when it's asked for, as it imports this file. */
const markFor = async (conf: Env, query: string) => {
  const { askOf, socialMark, SOCIAL_COOKIE } = await import("./handle.ts");
  const q = new URLSearchParams(query), ask = await askOf((k) => q.get(k), conf);
  return ask && ask !== "bad" ? { name: SOCIAL_COOKIE, value: await socialMark(conf, ask), path: "/login" } : null;
};

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

/** The longest name an account keeps. */
export const NAME_MAX = 100;

const MOODS = ["Quiet", "Brave", "Sunny", "Swift", "Lucky", "Merry", "Clever", "Gentle", "Bold", "Breezy", "Cosmic", "Plucky"];
const CRITTERS = ["Otter", "Fox", "Heron", "Badger", "Lynx", "Puffin", "Wombat", "Gecko", "Marten", "Finch", "Panda", "Hare"];

/** The name friends see when a sign-in brought none (Apple lets people share no name): the email's first half, or for Apple's
 * hidden relay address, which is random letters, a friendly "Sunny Otter 42" picked from the address so it stays the same. */
export function nameFor(email: string) {
  const [local = "", domain = ""] = email.split("@");
  if (domain.toLowerCase() !== "privaterelay.appleid.com" && local) return local;
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${MOODS[h % MOODS.length]} ${CRITTERS[(h >>> 8) % CRITTERS.length]} ${(h >>> 16) % 90 + 10}`;
}

const make = (conf: Env, origin: string) => betterAuth({
  database: conf.DB,
  secret: conf.BETTER_AUTH_SECRET,
  baseURL: conf.BETTER_AUTH_URL ?? origin,
  basePath: "/api/auth",
  // Apple posts its callback from its own origin.
  trustedOrigins: [conf.BETTER_AUTH_URL ?? origin, "https://appleid.apple.com"],
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  // GitHub's, Google's and Apple's tokens are kept encrypted with BETTER_AUTH_SECRET (AES-GCM): a copy of the database alone opens nothing.
  // A token kept before this stays readable and is replaced, encrypted, at that person's next sign-in.
  // One account, several ways in: someone signed in adds GitHub, Google or Apple from the Account tab (/do/link), whatever
  // email that provider knows them by, since they proved both. A sign-in never merges two accounts by itself.
  // A provider's sign-in joins an account of the same email only once that account's email was proved here (an unproved
  // sign-up at someone's address can't catch their GitHub). Better Auth's default today, set so an upgrade can't change it.
  account: { encryptOAuthTokens: true, accountLinking: { enabled: true, allowDifferentEmails: true, requireLocalEmailVerified: true } },
  // Better Auth's own email change and self-delete stay off (its defaults, set so an upgrade can't turn them on): an email
  // changed there skips eqosys's checks, and a delete there skips deleteAccount's sweep of friends, parties, saves and apps.
  // Deleting is /delete (type the email) or POST /api/account/delete from an app.
  user: { changeEmail: { enabled: false }, deleteUser: { enabled: false } },
  // Its own cookie name: the QNTBR site's session cookie is set on all of .qntbr.com under Better Auth's default one,
  // and would ride along to eqosys.qntbr.com beside ours.
  advanced: { cookiePrefix: "eqosys" },
  // Company sign-in through a studio's own provider (sso.ts): its callback is a Better Auth endpoint, so its session is one of these.
  plugins: [ssoPlugin(conf, (ask) => markFor(conf, ask))],
  // A studio that made company sign-in the only way in for its proved domain (sso.ts ssoOnly): any other way to make an account
  // or a session with an email there is refused, the company's own callback aside.
  databaseHooks: {
    user: { create: { before: async (user, ctx) => (ctx?.path !== "/sso/callback" && await ssoRequired(conf, user.email) ? false : { data: { ...user, name: (user.name?.trim() || nameFor(user.email)).slice(0, NAME_MAX) } }) },
      // Better Auth's update-user takes a name of any length; the hub and the boards don't (a longer one broke other people's reads).
      update: { before: async (user) => ({ data: typeof user.name === "string" ? { ...user, name: user.name.slice(0, NAME_MAX) } : user }) } },
    session: { create: { before: async (session, ctx) => {
      if (ctx?.path === "/sso/callback") return;
      const email = await conf.DB.prepare(`SELECT email FROM "user" WHERE id = ?`).bind(session.userId).first<string>("email");
      return email && await ssoRequired(conf, email) ? false : undefined;
    } } },
  },
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

/** One way this person signs in: its row (what /do/unlink takes) and "credential" (email and password), "github", "google" or "apple". */
export interface Way { id: string; provider: string }
/** The ways the signed-in person can sign in, for the Account tab. */
export async function waysOf(req: Request, conf: Env): Promise<Way[]> {
  const rows = await authFor(req, conf).api.listUserAccounts({ headers: req.headers }).catch(() => []);
  return rows.map((r) => ({ id: r.id, provider: r.providerId }));
}

/** A provider token as Better Auth keeps it, readable: encrypted ones are hex (encryptOAuthTokens), older ones plain. Null when it won't open. */
export async function oauthToken(conf: Env, kept: string | null): Promise<string | null> {
  if (!kept || !conf.BETTER_AUTH_SECRET || !/^([0-9a-f]{2})+$/i.test(kept)) return kept;
  return symmetricDecrypt({ key: conf.BETTER_AUTH_SECRET, data: kept }).catch(() => null);
}

export const isAdmin = (me: Me | null, conf: Env) =>
  !!me && !!conf.SUPER_ADMIN_EMAIL && me.email.trim().toLowerCase() === conf.SUPER_ADMIN_EMAIL.trim().toLowerCase();
