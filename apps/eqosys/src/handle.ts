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
import { b64url, crossSite, json, loopbackOn, VERSION, type Env } from "./env.ts";
import { hubAsk, hubOf, Op, type Who } from "./hub.ts";
import { codeOf, mintCode, PARTY_LIFE, partyOf } from "./party.ts";
import { deleteAccount, exchange, link, mint, setAccess } from "./members.ts";
import { oauth } from "./oauth.ts";
import { file } from "./reports.ts";
import { get as getSave, MAX_BODY, put as putSave, slotOf } from "./saves.ts";
import { shownFor, unlock, unlocksOf } from "./achievements.ts";
import { audOf, jwksOf, sign, verify } from "@rustybuns/util/token";
import { RoomMintGate } from "@rustybuns/util/limits";
import { json as publicJson } from "@rustybuns/util/http";
import { check, obj, oneOf, str } from "@rustybuns/util/guard";

/** An app asking for someone: where to send them back, and the proof only the app can finish. */
export interface Ask {
  app: QApp; back: URL; challenge: string; state: string; /** An OpenID client's, signed into its id_token. */ nonce?: string;
  /** The app asked to show the page even to someone already signed in (OpenID's `prompt=login` or `select_account`), say for "switch account". */
  pick?: true;
}

const CHALLENGE = str(128, { min: 43, re: /^[A-Za-z0-9_-]+$/ });

/** The ask in a query or a form: an Ask, null for none, "bad" for one that names an unknown app or a return it doesn't own. */
export function askOf(get: (k: string) => unknown, conf: Env): Ask | null | "bad" {
  if (!get("app")) return null;
  const app = appOf(get("app"));
  const back = app && returnTo(app, get("return"), loopbackOn(conf));
  const challenge = check(CHALLENGE, get("challenge"));
  if (!app || !back || !challenge) return "bad";
  const nonce = String(get("nonce") ?? "").slice(0, 200);
  const pick = /\b(login|select_account|consent)\b/.test(String(get("prompt") ?? ""));
  return { app, back, challenge, state: String(get("state") ?? "").slice(0, 200), ...(nonce ? { nonce } : {}), ...(pick ? { pick: true as const } : {}) };
}

/** The ask carried on as query parameters (into a social callback, or back to the login page). */
export const askQuery = (a: Ask) =>
  new URLSearchParams({ app: a.app.id, return: a.back.href, challenge: a.challenge, ...(a.state ? { state: a.state } : {}), ...(a.nonce ? { nonce: a.nonce } : {}), ...(a.pick ? { prompt: "select_account" } : {}) }).toString();

/** The mark a social sign-in's callback carries back to /login, so the person goes straight on to the app they pressed
 * "Continue with…" for: an HMAC of the ask's challenge under the auth secret, which a link somebody else made can't have. */
export async function socialMark(conf: Env, a: Ask) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(conf.BETTER_AUTH_SECRET ?? ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`social:${a.app.id}:${a.challenge}`)))).slice(0, 32);
}

/** Whether someone already signed in goes on to the app without seeing the page: they have used it before, or they just
 * pressed "Continue with…" for it. A first visit from a link still asks, so nobody is handed to an app they never picked. */
async function goesStraightOn(conf: Env, userId: string, a: Ask, mark: string | null) {
  if (a.pick) return false;
  if (mark && mark === await socialMark(conf, a)) return true;
  return !!(await conf.DB.prepare("SELECT 1 AS n FROM links WHERE user_id = ? AND app = ?").bind(userId, a.app.id).first<number>("n"));
}

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

const mints = new RoomMintGate(12, 60_000);
/** A token's app and who it names, or null when it isn't one eqosys signed for a known app. */
async function tokenOf(req: Request, conf: Env, token: string | null | undefined) {
  const app = token ? appOf(audOf(token)) : undefined;
  const claims = token && app ? await verify(token, await jwksOf(conf), { iss: issuer(req, conf), aud: app.id }) : null;
  return app && claims ? { app, who: { id: claims.sub, name: claims.name, app: app.id } } : null;
}

/** Signed in: on to the app with a fresh code, or home when nobody asked. */
async function onward(conf: Env, userId: string, ask: Ask | null, from?: Response) {
  if (!ask) { await link(conf, userId, null); return see("/", from); }
  const [code] = await Promise.all([mint(conf, userId, ask.app, ask.challenge, ask.nonce), link(conf, userId, ask.app)]);
  const to = new URL(ask.back);
  to.searchParams.set("code", code);
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

  // Qollab: POST /q/party (bearer token) mints a code, good 24 hours, thirteen a minute refused per address.
  if (pathname === "/q/party") {
    const head = cors(req, conf);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "POST") return json({ error: "POST with the token as a bearer" }, 405, head);
    if (!conf.PARTY) return json({ error: "no parties here" }, 503, head);
    const t = await tokenOf(req, conf, /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1]);
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    const ip = req.headers.get("cf-connecting-ip") ?? "local";
    for (let i = 0; i < 5; i++) {
      const code = mintCode();
      if (!mints.allow(ip, code, Date.now())) return json({ error: "too many parties just now; wait a minute" }, 429, head);
      const made = await partyOf(conf.PARTY, code).fetch(new Request(`https://party/make?${new URLSearchParams({ ...t.who, code, ...(new URL(req.url).searchParams.get("open") === "1" ? { open: "1" } : {}) })}`));
      if (made.ok) return json({ code, expires: Date.now() + PARTY_LIFE }, 200, head);
    }
    return json({ error: "couldn't mint a code; try again" }, 503, head);
  }

  // A party (party.ts, Qollab): a live socket at /q/party/<code>?token=. The token's own app is the party's; another app's is refused.
  const party = /^\/q\/party\/([^/]+)$/.exec(pathname);
  if (party) {
    if (!conf.PARTY) return json({ error: "no parties here" }, 503);
    const code = codeOf(party[1]!);
    if (!code) return json({ error: "that isn't a party code" }, 400);
    const t = await tokenOf(req, conf, new URL(req.url).searchParams.get("token"));
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401);
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "a websocket" }, 426);
    const origin = req.headers.get("origin");
    if (origin && !returnTo(t.app, origin, loopbackOn(conf))) return json({ error: "not from that app's site" }, 403);
    // Remember the seat so deleting the account can clear it (members.ts); seats older than a party lives are pruned here.
    const now = Date.now();
    await conf.DB.batch([
      conf.DB.prepare("DELETE FROM party_seats WHERE at < ?").bind(now - PARTY_LIFE),
      conf.DB.prepare("INSERT INTO party_seats (user_id, code, at) VALUES (?, ?, ?) ON CONFLICT (user_id, code) DO UPDATE SET at = excluded.at").bind(t.who.id, code, now),
    ]);
    return partyOf(conf.PARTY, code).fetch(new Request(`https://party/socket?${new URLSearchParams({ ...t.who, code })}`, { headers: { upgrade: "websocket" } }));
  }

  // Qollab cloud saves (saves.ts): PUT /q/save/<slot> keeps an opaque body, GET brings the newest (or ?v=<id>) back. The token's own app is the save's.
  const save = /^\/q\/save\/([^/]+)$/.exec(pathname);
  if (save) {
    const head = { ...cors(req, conf), "access-control-allow-methods": "GET, PUT", "access-control-expose-headers": "x-save-id, x-save-at" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "PUT" && req.method !== "GET") return json({ error: "PUT a save or GET one, with the token as a bearer" }, 405, head);
    const slot = slotOf(save[1]!);
    if (!slot) return json({ error: "a slot is 1-40 letters, digits, - or _" }, 400, head);
    const t = await tokenOf(req, conf, /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1]);
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    if (req.method === "GET") {
      const v = Number(new URL(req.url).searchParams.get("v")) || undefined;
      const found = await getSave(conf, t.who.id, t.app.id, slot, v);
      return found ? new Response(found.data, { headers: { ...head, "content-type": "application/octet-stream", "cache-control": "private, no-store", "x-save-id": String(found.id), "x-save-at": String(found.at) } })
        : json({ error: "no save there" }, 404, head);
    }
    if (Number(req.headers.get("content-length")) > MAX_BODY) return json({ error: `a save is up to ${MAX_BODY / 1024} KB` }, 413, head);
    const r = await putSave(conf, t.who.id, t.app.id, slot, new Uint8Array(await req.arrayBuffer()));
    return r.ok ? json({ ok: true, id: r.id, at: r.at, previous: r.previous }, 200, head) : json({ error: r.error }, r.status, head);
  }

  // Achievements (achievements.ts): POST /q/achieve { id } unlocks one of the token's app's, GET lists its whole catalog for the person.
  if (pathname === "/q/achieve") {
    const head = { ...cors(req, conf), "access-control-allow-methods": "GET, POST" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "POST" && req.method !== "GET") return json({ error: "POST { id } or GET, with the token as a bearer" }, 405, head);
    const t = await tokenOf(req, conf, /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1]);
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    if (req.method === "GET") return json({ achievements: shownFor(t.app.id, (await unlocksOf(conf, t.who.id, t.app.id)).get(t.app.id)) }, 200, head);
    const body = check(obj({ id: str(64) }), await req.json().catch(() => null));
    if (!body) return json({ error: "send { id }" }, 400, head);
    const r = await unlock(conf, t.who.id, t.app.id, body.id);
    return r.ok ? json({ achievement: r.achievement, new: r.new }, 200, head) : json({ error: r.error }, r.status, head);
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
    return json({ ok: await deleteAccount(conf, claims.sub, issuer(req, conf)) }, 200, head);
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

  // An app asking for someone already signed in here who uses it (or just picked it with "Continue with…"): straight back
  // with a code, no page. Anyone else falls through to the sign-in page.
  if (pathname === "/login" && req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const ask = askOf((k) => q.get(k), conf);
    const me = ask && ask !== "bad" ? await meOf(req, conf) : null;
    if (me && ask && ask !== "bad" && await goesStraightOn(conf, me.id, ask, q.get("via"))) return onward(conf, me.id, ask);
    return null;
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
    await deleteAccount(conf, me.id, issuer(req, conf));
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
    const callbackURL = `/login${ask ? `?${askQuery(ask)}&via=${await socialMark(conf, ask)}` : ""}`;
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
