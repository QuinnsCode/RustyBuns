// Everything that isn't a page: the forms, the code exchange apps call, Better Auth's own routes (social
// sign-in comes back through them) and /health. Returns null for a path that is none of these.
//
// The handoff, the way OAuth does it with PKCE, minus the parts nobody here needs yet:
//   1. the app sends the person to /login?app=<id>&return=<url on its origin>&challenge=<S256 of a verifier>&state=<anything>
//   2. they sign in or sign up here (or are already), and press Continue
//   3. eqosys sends them to <return>?code=eq_…&state=…
//   4. the app POSTs /api/exchange { app, code, verifier } and gets back who they are, where they came from and their access,
//      plus a token signed with the key at /.well-known/jwks.json that its server can pass around and check on its own
import { appOf, APPS, HOME, isLoopback, returnTo, type QApp } from "./apps.ts";
import { authFor, authOn, isAdmin, meOf, providers, type Me } from "./auth.ts";
import { crossSite, json, loopbackOn, VERSION, type Env } from "./env.ts";
import { hubAsk, hubOf, Op, type Who } from "./hub.ts";
import { deleteAccount, exchange, link, mint, setAccess } from "./members.ts";
import { oauth } from "./oauth.ts";
import { file } from "./reports.ts";
import { audOf, jwksOf, sign, verify } from "@rustybuns/util/token";
import { json as publicJson } from "@rustybuns/util/http";
import { check, obj, oneOf, str } from "@rustybuns/util/guard";

/** An app asking for someone: where to send them back, and the proof only the app can finish. */
export interface Ask { app: QApp; back: URL; challenge: string; state: string; /** An OpenID client's, signed into its id_token. */ nonce?: string }

const CHALLENGE = str(128, { min: 43, re: /^[A-Za-z0-9_-]+$/ });

/** The ask in a query or a form: an Ask, null for none, "bad" for one that names an unknown app or a return it doesn't own. */
export function askOf(get: (k: string) => unknown, conf: Env): Ask | null | "bad" {
  if (!get("app")) return null;
  const app = appOf(get("app"));
  const back = app && returnTo(app, get("return"), loopbackOn(conf));
  const challenge = check(CHALLENGE, get("challenge"));
  if (!app || !back || !challenge) return "bad";
  const nonce = String(get("nonce") ?? "").slice(0, 200);
  return { app, back, challenge, state: String(get("state") ?? "").slice(0, 200), ...(nonce ? { nonce } : {}) };
}

/** The ask carried on as query parameters (into a social callback, or back to the login page). */
export const askQuery = (a: Ask) =>
  new URLSearchParams({ app: a.app.id, return: a.back.href, challenge: a.challenge, ...(a.state ? { state: a.state } : {}), ...(a.nonce ? { nonce: a.nonce } : {}) }).toString();

export const see = (to: string, from?: Response) => {
  const headers = new Headers({ location: to });
  for (const c of from?.headers.getSetCookie?.() ?? []) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
};
/** Who a token says signed it: eqosys's own origin, the one apps verify against. */
export const issuer = (req: Request, conf: Env) => conf.BETTER_AUTH_URL ? new URL(conf.BETTER_AUTH_URL).origin : new URL(req.url).origin;
const field = (f: FormData, k: string) => String(f.get(k) ?? "");
/** The signed-in person on eqosys's own pages, as their hub sees them: the app they are in is eqosys itself. */
export const atHome = (me: Me): Who => ({ id: me.id, name: me.name, app: HOME });

/** Signed in: on to the app with a fresh code, or home when nobody asked. */
async function onward(conf: Env, userId: string, ask: Ask | null, from?: Response) {
  await link(conf, userId, ask?.app ?? null);
  if (!ask) return see("/", from);
  const to = new URL(ask.back);
  to.searchParams.set("code", await mint(conf, userId, ask.app, ask.challenge, ask.nonce));
  if (ask.state) to.searchParams.set("state", ask.state);
  return see(to.href, from);
}

const Signed = obj({ user: obj({ id: str(200) }) });
const Social = obj({ url: str(4000) });
const Exchange = obj({ app: str(64), code: str(100), verifier: str(128, { min: 43 }) });

/** CORS for an app's own page calling /api/exchange or /api/hub (a game with no server of its own). */
const appOrigins = new Set(APPS.flatMap((a) => a.origins));
export function cors(req: Request, conf: Env): Record<string, string> {
  const origin = req.headers.get("origin");
  return origin && (appOrigins.has(origin) || (loopbackOn(conf) && isLoopback(origin)))
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type, authorization", vary: "origin" }
    : {};
}

export async function handle(req: Request, conf: Env): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const openid = await oauth(req, conf);
  if (openid) return openid;

  if (pathname === "/api/exchange") {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, conf) });
    if (req.method !== "POST") return json({ error: "POST { app, code, verifier }" }, 405);
    const body = check(Exchange, await req.json().catch(() => null));
    if (!body) return json({ error: "send { app, code, verifier }" }, 400, cors(req, conf));
    const traded = await exchange(conf, body.app, body.code, body.verifier);
    if (!traded) return json({ error: "that code is used, late, for another app, or the verifier is wrong" }, 400, cors(req, conf));
    return json({ ...traded.who, token: await sign(conf, issuer(req, conf), traded.who) }, 200, cors(req, conf));
  }

  // A person's hub (hub.ts): a live socket at /hub?token=, or one op at POST /api/hub with the token as a bearer.
  // The token is the proof, so the hub needs no cookie; a socket stays open after its token expires.
  if (pathname === "/hub" || pathname === "/api/hub") {
    const socket = pathname === "/hub", head = cors(req, conf);
    if (!socket && req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (!conf.HUB) return json({ error: "no hub here" }, 503, head);
    const token = socket ? new URL(req.url).searchParams.get("token") : /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    const app = token ? appOf(audOf(token)) : undefined;
    const claims = token && app ? await verify(token, await jwksOf(conf), { iss: issuer(req, conf), aud: app.id }) : null;
    if (!app || !claims) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    const who = { id: claims.sub, name: claims.name, app: app.id };
    if (socket) {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "a websocket" }, 426);
      // A page on somebody else's site can't open it with a token it lifted.
      const origin = req.headers.get("origin");
      if (origin && !returnTo(app, origin, loopbackOn(conf))) return json({ error: "not from that app's site" }, 403);
      return hubOf(conf.HUB, who.id).fetch(new Request(`https://hub/socket?${new URLSearchParams(who)}`, { headers: { upgrade: "websocket" } }));
    }
    if (req.method !== "POST") return json({ error: "POST an op" }, 405, head);
    const op = check(Op, await req.json().catch(() => null));
    if (!op) return json({ error: "send { op: state | befriend | accept | drop | notify | clear }" }, 400, head);
    const r = await hubAsk(conf.HUB, who, op);
    return json(r, "error" in r ? 400 : 200, head);
  }

  // Account deletion from inside an app (App Store guideline 5.1.1(v)): the app's own token is the proof.
  if (pathname === "/api/account/delete") {
    const head = cors(req, conf);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "POST") return json({ error: "POST with the token as a bearer" }, 405, head);
    const token = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    const app = token ? appOf(audOf(token)) : undefined;
    const claims = token && app ? await verify(token, await jwksOf(conf), { iss: issuer(req, conf), aud: app.id }) : null;
    if (!claims) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    return json({ ok: await deleteAccount(conf, claims.sub) }, 200, head);
  }

  // A bug report, suggestion or error from a game, filed as a GitHub issue (reports.ts). The app's token says which game and which account.
  if (pathname === "/api/report") {
    const head = cors(req, conf);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "POST") return json({ error: "POST { kind, title, body } with the token as a bearer" }, 405, head);
    const token = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    const app = token ? appOf(audOf(token)) : undefined;
    const claims = token && app ? await verify(token, await jwksOf(conf), { iss: issuer(req, conf), aud: app.id }) : null;
    if (!app || !claims) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    if (conf.REPORT_LIMIT && !(await conf.REPORT_LIMIT.limit({ key: req.headers.get("cf-connecting-ip") ?? "local" })).success)
      return json({ error: "slow down a moment" }, 429, head);
    const filed = await file(conf, app, claims.sub, req.headers.get("user-agent") ?? "", await req.json().catch(() => null));
    return filed.ok ? json({ ok: true, issue: filed.issue }, 200, head) : json({ error: filed.error }, filed.status, head);
  }

  // The public half of the signing key: anyone may fetch it, and a few minutes' cache is fine.
  if (pathname === "/.well-known/jwks.json" && req.method === "GET")
    return publicJson(await jwksOf(conf), 200, { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" });

  // Public and thin: up or down, nothing about who is signed up.
  if (pathname === "/health" && req.method === "GET") {
    const db = await conf.DB.prepare("SELECT 1 AS n").first().then(() => true, () => false);
    return json({ ok: db && authOn(conf), db, auth: authOn(conf), tokens: !!(await jwksOf(conf)).keys.length, version: VERSION }, db ? 200 : 503);
  }

  const limited = () => conf.AUTH_LIMIT?.limit({ key: req.headers.get("cf-connecting-ip") ?? "local" }).then((r) => !r.success);

  // Better Auth's routes: the social sign-in callback lands here.
  if (pathname.startsWith("/api/auth/")) {
    if (!authOn(conf)) return json({ error: "accounts off" }, 503);
    if (req.method === "POST" && await limited()) return json({ error: "too many sign-in attempts: wait a minute" }, 429);
    return authFor(req, conf).handler(req);
  }

  if (!pathname.startsWith("/do/") || req.method !== "POST") return null;
  if (crossSite(req, conf)) return json({ error: "cross-site request refused" }, 403);
  if (!authOn(conf)) return json({ error: "accounts off" }, 503);
  const act = pathname.slice(4);
  const form = await req.formData().catch(() => new FormData());
  // The page an app opens for deleting an account (/delete): typing the email is the confirmation. Before the ask, which it doesn't carry.
  if (act === "delete") {
    const me = await meOf(req, conf), app = appOf(field(form, "app"));
    if (!me) return see("/login?e=in");
    if (field(form, "confirm").trim().toLowerCase() !== me.email.toLowerCase()) return see(`/delete?e=confirm${app ? "&app=" + app.id : ""}`);
    const out = await authFor(req, conf).api.signOut({ headers: req.headers, asResponse: true }).catch(() => undefined);
    await deleteAccount(conf, me.id);
    return see(`/deleted${app ? "?app=" + app.id : ""}`, out);
  }
  const ask = askOf((k) => form.get(k), conf);
  if (ask === "bad") return see("/login?e=app");
  const back = (e: string) => see(`/login?e=${e}${ask ? "&" + askQuery(ask) : ""}`);

  if (act === "signin" || act === "signup") {
    if (await limited()) return back("slow");
    const email = field(form, "email").trim(), password = field(form, "password");
    const auth = authFor(req, conf);
    const res = await (act === "signup"
      ? auth.api.signUpEmail({ body: { email, password, name: field(form, "name").trim() || email.split("@")[0]! }, asResponse: true })
      : auth.api.signInEmail({ body: { email, password }, asResponse: true })).catch(() => null);
    const signed = res?.ok ? check(Signed, await res.clone().json().catch(() => null)) : null;
    return signed ? onward(conf, signed.user.id, ask, res!) : back(act === "signup" ? "taken" : "bad");
  }

  if (act === "social") {
    const provider = check(oneOf(["github", "google", "apple"]), field(form, "provider"));
    if (!provider || !providers(conf).includes(provider)) return back("provider");
    // Back to the login page signed in, where Continue hands them on.
    const callbackURL = `/login${ask ? "?" + askQuery(ask) : ""}`;
    const res = await authFor(req, conf).api.signInSocial({ body: { provider, callbackURL }, asResponse: true }).catch(() => null);
    const go = res?.ok ? check(Social, await res.clone().json().catch(() => null)) : null;
    return go ? see(go.url, res!) : back("provider");
  }

  const me = await meOf(req, conf);
  if (!me) return back("in");

  if (act === "continue") return onward(conf, me.id, ask);
  // The friends page (pages.tsx): the person's own hub, by cookie rather than a token. A form field left empty is left out.
  if (act === "befriend" || act === "accept" || act === "drop" || act === "clear") {
    if (!conf.HUB) return see("/?tab=friends&e=nohub");
    const email = field(form, "email").trim(), id = field(form, "id");
    const r = await hubAsk(conf.HUB, atHome(me), { op: act, ...(email ? { email } : {}), ...(id ? { id } : {}) });
    return see("error" in r ? `/?tab=friends&e=${/most|too many/.test(r.error) ? "full" : "hub"}` : "/?tab=friends");
  }
  if (act === "logout") return see(ask ? `/login?${askQuery(ask)}` : "/login", await authFor(req, conf).api.signOut({ headers: req.headers, asResponse: true }));
  if (act === "grant" || act === "revoke") {
    if (!isAdmin(me, conf)) return json({ error: "only the super admin grants access" }, 403);
    const role = field(form, "role").trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(role)) return see("/?tab=people&e=role");
    const ok = await setAccess(conf, field(form, "email"), field(form, "for_app"), role, act === "grant", me.email);
    return see(ok ? "/?tab=people" : "/?tab=people&e=who");
  }
  return json({ error: "not found" }, 404);
}
