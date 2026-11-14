// Everything that isn't a page: the forms, the code exchange apps call, Better Auth's own routes (social
// sign-in comes back through them) and /health. Returns null for a path that is none of these.
//
// The handoff, the way OAuth does it with PKCE, minus the parts nobody here needs yet:
//   1. the app sends the person to /login?app=<id>&return=<url on its origin>&challenge=<S256 of a verifier>&state=<anything>
//   2. they sign in or sign up here (or are already), and press Continue
//   3. eqosys sends them to <return>?code=eq_…&state=…
//   4. the app POSTs /api/exchange { app, code, verifier } and gets back who they are, where they came from and their access,
//      plus a token signed with the key at /.well-known/jwks.json that its server can pass around and check on its own
import { HOME, returnTo, type QApp } from "./apps.ts";
import { appOf, Draft, mayUse, pull, save, send, type Done } from "./listings.ts";
import { authFor, authOn, isAdmin, meOf, providers, type Me } from "./auth.ts";
import { b64url, crossSite, json, loopbackOn, VERSION, type Env } from "./env.ts";
import { hubAnnounce, hubAsk, hubInvited, hubRedeem, linkOf, type Who } from "./qollab/hub.ts";
import { isQollab, qollab } from "./qollab/routes.ts";
import { makeSpace, SPACE_NAME, studioRemove } from "./qollab/space.ts";
import { bearerOf, cors, HOME_LIFE, issuer, tokenOf } from "./door.ts";
import { deleteAccount, exchange, link, mint, mintRefresh, setAccess, signOutApps } from "./members.ts";
import { oauth } from "./oauth.ts";
import { appleEvents } from "./apple.ts";
import { addMember, Kind, makeStudio, Role, STUDIO_NAME } from "./studios.ts";
import { recordDeploy } from "./deploys.ts";
import { file } from "./reports.ts";
import { shownFor, unlock, unlocksOf } from "./achievements.ts";
import { AGENTS_TEXT, callTool, catalog, type Ctx } from "./tools.ts";
import { jwksOf, sign } from "@rustybuns/util/token";
import { json as publicJson } from "@rustybuns/util/http";
import { bool, check, obj, oneOf, opt, str } from "@rustybuns/util/guard";
import { dossierHeaders, regionAt, type Region } from "@rustybuns/util/privacy";
import { exportFor, HOLDERS } from "./privacy.ts";
import { regionFor, vaultFor } from "./vault.ts";
import { beacon } from "./visitors.ts";

/** An app asking for someone: where to send them back, and the proof only the app can finish. */
export interface Ask {
  app: QApp; back: URL; challenge: string; state: string; /** An OpenID client's, signed into its id_token. */ nonce?: string;
  /** The app asked to show the page even to someone already signed in (OpenID's `prompt=login` or `select_account`), say for "switch account". */
  pick?: true;
  /** The app asked not to show any page (OpenID's `prompt=none`): a code back for someone who goes straight on, else `error=login_required`. */
  quiet?: true;
}

const CHALLENGE = str(128, { min: 43, re: /^[A-Za-z0-9_-]+$/ });

/** The ask in a query or a form: an Ask, null for none, "bad" for one that names an unknown app or a return it doesn't own. */
export async function askOf(get: (k: string) => unknown, conf: Env): Promise<Ask | null | "bad"> {
  if (!get("app")) return null;
  const app = await appOf(conf, get("app"));
  const back = app && returnTo(app, get("return"), loopbackOn(conf));
  const challenge = check(CHALLENGE, get("challenge"));
  if (!app || !back || !challenge) return "bad";
  const nonce = String(get("nonce") ?? "").slice(0, 200);
  const prompt = String(get("prompt") ?? "");
  const pick = /\b(login|select_account|consent)\b/.test(prompt), quiet = !pick && /\bnone\b/.test(prompt);
  return { app, back, challenge, state: String(get("state") ?? "").slice(0, 200), ...(nonce ? { nonce } : {}), ...(pick ? { pick: true as const } : {}), ...(quiet ? { quiet: true as const } : {}) };
}

/** The ask carried on as query parameters (into a social callback, or back to the login page). */
export const askQuery = (a: Ask) =>
  new URLSearchParams({ app: a.app.id, return: a.back.href, challenge: a.challenge, ...(a.state ? { state: a.state } : {}), ...(a.nonce ? { nonce: a.nonce } : {}), ...(a.pick ? { prompt: "select_account" } : a.quiet ? { prompt: "none" } : {}) }).toString();

/** The mark that says this browser pressed "Continue with…" for this ask: an HMAC of the ask's app and challenge under the
 * auth secret. It rides in a cookie, never the URL, so a link somebody else made can't carry it into another browser. */
export async function socialMark(conf: Env, a: Ask) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(conf.BETTER_AUTH_SECRET ?? ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`social:${a.app.id}:${a.challenge}`)))).slice(0, 32);
}

/** The cookie /do/social sets and /login reads back once: ten minutes is plenty for a provider's sign-in page. */
export const SOCIAL_COOKIE = "eqosys.social";
const socialCookie = (req: Request, value: string, age: number) =>
  `${SOCIAL_COOKIE}=${value}; Path=/login; Max-Age=${age}; HttpOnly; SameSite=Lax${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
const cookieOf = (req: Request, name: string) =>
  (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
const socialMarkIn = (req: Request) => cookieOf(req, SOCIAL_COOKIE);

/** The friend link this browser opened (/add/<id>/<key>), kept half an hour while its person signs in or makes an account.
 * Opening a link only keeps it: being friends takes their own press of "Be friends" on the Friends tab (/do/add), so a
 * page that sends a browser to somebody's link makes nobody a friend. */
export const ADD_COOKIE = "eqosys.add";
const addCookie = (req: Request, value: string, age: number) =>
  `${ADD_COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
/** The kept friend link, and whose it is: null when there is none or its key is no longer theirs. */
export async function invitedBy(req: Request, conf: Env): Promise<{ id: string; key: string; name: string } | null> {
  const l = linkOf(cookieOf(req, ADD_COOKIE) ?? "");
  const name = l && conf.HUB ? await hubInvited(conf.HUB, l).catch(() => null) : null;
  return l && name !== null ? { ...l, name } : null;
}

/** Whether someone already signed in goes on to the app without seeing the page: they have used it before, or this browser
 * just pressed "Continue with…" for it. A first visit from a link still asks, so nobody is handed to an app they never picked. */
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
const field = (f: FormData, k: string) => String(f.get(k) ?? "");
/** The signed-in person on eqosys's own pages, as their hub sees them: the app they are in is eqosys itself. */
export const atHome = (me: Me): Who => ({ id: me.id, name: me.name, app: HOME });

/** Signed in: on to the app with a fresh code, or home when nobody asked. A studio's game still in the making sends only its studio on. */
async function onward(conf: Env, region: Region, userId: string, ask: Ask | null, from?: Response) {
  if (!ask) { await link(conf, userId, null, region); return see("/", from); }
  if (!(await mayUse(conf, ask.app, userId))) return see("/?e=making", from);
  const [code] = await Promise.all([mint(conf, userId, ask.app, ask.challenge, ask.back, ask.nonce), link(conf, userId, ask.app, region)]);
  const to = new URL(ask.back);
  to.searchParams.set("code", code);
  if (ask.state) to.searchParams.set("state", ask.state);
  return see(to.href, from);
}

const Signed = obj({ user: obj({ id: str(200) }) });
const Social = obj({ url: str(4000) });
/** `keep`: a game page that renews its token in the background (`@rustybuns/util/eqosys`) also gets a refresh token, marked as a page's. */
const Exchange = obj({ app: str(64), code: str(100), verifier: str(128, { min: 43 }), return: opt(str(2000)), keep: opt(bool()) });

export async function handle(req: Request, conf: Env): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const openid = await oauth(req, conf);
  if (openid) return openid;
  // Qollab's paths go to its own Worker (apps/qollab) when it is bound, else run here: same paths, same answers.
  const q = conf.QOLLAB && isQollab(pathname) ? await conf.QOLLAB.fetch(req) : await qollab(req, conf);
  if (q) return q;

  if (pathname === "/api/exchange") {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: await cors(req, conf) });
    if (req.method !== "POST") return json({ error: "POST { app, code, verifier }" }, 405);
    const body = check(Exchange, await req.json().catch(() => null));
    if (!body) return json({ error: "send { app, code, verifier }" }, 400, await cors(req, conf));
    const traded = await exchange(conf, body.app, body.code, body.verifier, body.return);
    if (!traded) return json({ error: "that code is used, late, for another app, or the verifier is wrong" }, 400, await cors(req, conf));
    const token = await sign(conf, issuer(req, conf), traded.who);
    const refresh = token && body.keep ? await mintRefresh(conf, traded.who.user.id, traded.who.app, Date.now(), true) : undefined;
    return json({ ...traded.who, token, ...(refresh ? { refresh } : {}) }, 200, await cors(req, conf));
  }

  // Achievements (achievements.ts): POST /q/achieve { id } unlocks one of the token's app's, GET lists its whole catalog for the person.
  if (pathname === "/q/achieve") {
    const head = { ...await cors(req, conf), "access-control-allow-methods": "GET, POST" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "POST" && req.method !== "GET") return json({ error: "POST { id } or GET, with the token as a bearer" }, 405, head);
    const t = await tokenOf(req, conf, bearerOf(req));
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    if (req.method === "GET") return json({ achievements: shownFor(t.app, (await unlocksOf(conf, t.who.id, t.app.id)).get(t.app.id)) }, 200, head);
    const body = check(obj({ id: str(64) }), await req.json().catch(() => null));
    if (!body) return json({ error: "send { id }" }, 400, head);
    const r = await unlock(conf, t.who.id, t.app.id, body.id);
    if (r.ok && r.new && conf.HUB) await hubAnnounce(conf.HUB, t.who, `unlocked ${r.achievement.name}`);
    return r.ok ? json({ achievement: r.achievement, new: r.new }, 200, head) : json({ error: r.error }, r.status, head);
  }

  // eqosys's own pages as an app (door.ts homeApp): GET /api/home-token, signed in, from eqosys's own page only, is a token for
  // the Qollab doors that take one (the spaces), good HOME_LIFE seconds; the /spaces page asks again before it runs out.
  if (pathname === "/api/home-token") {
    if (req.method !== "GET") return json({ error: "GET, signed in" }, 405);
    const origin = req.headers.get("origin"), site = req.headers.get("sec-fetch-site");
    if ((origin && origin !== issuer(req, conf)) || (site && site !== "same-origin")) return json({ error: "only eqosys's own pages" }, 403);
    const me = await meOf(req, conf);
    if (!me) return json({ error: "sign in at /login first" }, 401);
    const token = await sign(conf, issuer(req, conf), { user: { id: me.id, email: me.email, name: me.name }, app: HOME, source: HOME, access: [] }, Date.now(), {}, HOME_LIFE);
    return token ? json({ token, name: me.name, life: HOME_LIFE }) : json({ error: "no signing key here" }, 503);
  }

  // Privacy (privacy.ts): GET /api/privacy/export is everything eqosys holds about the person as one JSON file (GDPR's access and
  // portability); GET /api/privacy is what is kept, why and how long, plus their vault (region, consents, requests). The session
  // cookie, or an app's token as a bearer.
  if (pathname === "/api/privacy" || pathname === "/api/privacy/export") {
    const head = { ...await cors(req, conf), "access-control-allow-methods": "GET" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "GET") return json({ error: "GET, signed in or with the token as a bearer" }, 405, head);
    const bearer = bearerOf(req);
    const t = bearer ? await tokenOf(req, conf, bearer) : null, me = bearer ? null : await meOf(req, conf);
    const who = t ? t.who : me ? atHome(me) : null;
    if (!who) return json({ error: "sign in at /login first, or send an app's token as a bearer" }, 401, head);
    if (pathname === "/api/privacy/export")
      return new Response(JSON.stringify(await exportFor({ conf, me: { id: who.id, name: who.name } }), null, 2), { headers: { ...head, ...dossierHeaders("eqosys") } });
    const vault = await vaultFor(conf, who.id);
    return json({ region: await regionFor(conf, who.id), vault: vault && await vault.state(), holders: HOLDERS.map(({ export: _, ...h }) => h) }, 200, head);
  }

  // Account deletion from inside an app (App Store guideline 5.1.1(v)): the app's own token is the proof.
  if (pathname === "/api/account/delete") {
    const head = await cors(req, conf);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "POST") return json({ error: "POST with the token as a bearer" }, 405, head);
    const t = await tokenOf(req, conf, bearerOf(req));
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    return json({ ok: await deleteAccount(conf, t.who.id, issuer(req, conf)) }, 200, head);
  }

  // Sign in with Apple's server-to-server notifications (apple.ts): consent revoked signs them out, an Apple account deleted deletes ours.
  if (pathname === "/api/apple/events") return appleEvents(req, conf, issuer(req, conf));

  // A bug report, suggestion or error from a game, filed as a GitHub issue (reports.ts). The app's token says which game and which account.
  // A deploy reporting what went out (deploys.ts), signed with DEPLOY_REPORT_KEY: the shelf's Ship door reads it.
  if (pathname === "/api/deploys" && req.method === "POST") {
    const { status } = await recordDeploy(conf, req);
    return json(status === 200 ? { ok: true } : { error: status === 503 ? "deploy reports are off here" : status === 401 ? "unsigned" : status === 404 ? "no such app" : "bad or stale report" }, status);
  }
  if (pathname === "/api/report") {
    const head = await cors(req, conf);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "POST") return json({ error: "POST { kind, title, body } with the token as a bearer" }, 405, head);
    const t = await tokenOf(req, conf, bearerOf(req));
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    if (conf.REPORT_LIMIT && !(await conf.REPORT_LIMIT.limit({ key: req.headers.get("cf-connecting-ip") ?? "local" })).success)
      return json({ error: "slow down a moment" }, 429, head);
    const filed = await file(conf, t.app, t.who.id, req.headers.get("user-agent") ?? "", await req.json().catch(() => null));
    return filed.ok ? json({ ok: true, issue: filed.issue }, 200, head) : json({ error: filed.error }, filed.status, head);
  }

  // The public half of the signing key: anyone may fetch it, and a few minutes' cache is fine.
  // The tools (tools.ts): GET /api/tools lists them for anyone, POST /api/tools/<name> runs one for the session cookie or an app's bearer token.
  if (pathname === "/agents" && req.method === "GET") return new Response(AGENTS_TEXT, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (pathname === "/api/tools" && req.method === "GET") return json({ tools: catalog() });
  const toolCall = /^\/api\/tools\/([a-z_]{1,40})$/.exec(pathname);
  if (toolCall) {
    if (req.method !== "POST") return json({ error: "POST the arguments as JSON; GET /api/tools lists the tools" }, 405);
    const bearer = bearerOf(req);
    if (!bearer && crossSite(req, conf)) return json({ error: "cross-site" }, 403);
    const t = bearer ? await tokenOf(req, conf, bearer) : null, me = bearer ? null : await meOf(req, conf);
    const ctx: Ctx | null = t ? { conf, who: t.who, admin: false } : me ? { conf, who: atHome(me), email: me.email, admin: isAdmin(me, conf) } : null;
    if (!ctx) return json({ error: "sign in at /login first, or send an app's token as a bearer" }, 401);
    return callTool(ctx, toolCall[1]!, await req.json().catch(() => ({})));
  }

  // A page's visit beacon (visitors.ts): the Playground's views, and a tap, key or scroll on any of the sites it counts.
  if (pathname === "/api/visit") return beacon(conf, req);

  if (pathname === "/.well-known/jwks.json" && req.method === "GET")
    return publicJson(await jwksOf(conf), 200, { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" });

  // Public and thin: up or down, nothing about who is signed up.
  if (pathname === "/health" && req.method === "GET") {
    const db = await conf.DB.prepare("SELECT 1 AS n").first().then(() => true, () => false);
    return json({ ok: db && authOn(conf), db, auth: authOn(conf), tokens: !!(await jwksOf(conf)).keys.length, version: VERSION }, db ? 200 : 503);
  }

  // A friend link: kept in a cookie, then on to the Friends tab, by way of the sign-in page for someone signed out or new.
  const add = /^\/add\/(.+)$/.exec(pathname);
  if (add && req.method === "GET") {
    const l = linkOf(add[1]!.replace(/\/+$/, ""));
    const out = see("/?tab=friends");
    if (l) out.headers.append("set-cookie", addCookie(req, `${encodeURIComponent(l.id)}/${l.key}`, 1800));
    return out;
  }
  // Home with a friend link waiting (just signed in, or just made the account): the Friends tab shows who it is from.
  if (pathname === "/" && req.method === "GET" && !new URL(req.url).searchParams.has("tab") && cookieOf(req, ADD_COOKIE)) return see("/?tab=friends");

  // An app asking for someone already signed in here who uses it (or just picked it with "Continue with…"): straight back
  // with a code, no page. Anyone else falls through to the sign-in page.
  if (pathname === "/login" && req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const ask = await askOf((k) => q.get(k), conf);
    if (ask === "bad") return see("/login?e=app");
    const me = ask ? await meOf(req, conf) : null;
    const mark = socialMarkIn(req);
    if (me && ask && await goesStraightOn(conf, me.id, ask, mark)) {
      const out = await onward(conf, regionAt(req), me.id, ask);
      if (mark) out.headers.append("set-cookie", socialCookie(req, "", 0));
      return out;
    }
    // A game checking quietly on load (prompt=none): no page, just back to it as a guest, the way OpenID says.
    if (ask?.quiet) {
      ask.back.searchParams.set("error", "login_required");
      if (ask.state) ask.back.searchParams.set("state", ask.state);
      return see(ask.back.href);
    }
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
    const me = await meOf(req, conf), app = await appOf(conf, field(form, "app"));
    if (!me) return see("/login?e=in");
    if (field(form, "confirm").trim().toLowerCase() !== me.email.toLowerCase()) return see(`/delete?e=confirm${app ? "&app=" + app.id : ""}`);
    const out = await authFor(req, conf).api.signOut({ headers: req.headers, asResponse: true }).catch(() => undefined);
    await deleteAccount(conf, me.id, issuer(req, conf));
    return see(`/deleted${app ? "?app=" + app.id : ""}`, out);
  }
  const ask = await askOf((k) => form.get(k), conf);
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
    return signed ? onward(conf, regionAt(req), signed.user.id, ask, res!) : back(act === "signup" ? "taken" : "bad");
  }

  if (act === "social") {
    // Each press starts a provider's OAuth dance (a state row, a redirect): held to the same per-address limit as a password.
    if (await limited()) return back("slow");
    const provider = check(oneOf(["github", "google", "apple"]), field(form, "provider"));
    if (!provider || !providers(conf).includes(provider)) return back("provider");
    // Back to the login page signed in, and on to the app: the mark rides in this browser's cookie, not the callback URL.
    const callbackURL = `/login${ask ? `?${askQuery(ask)}` : ""}`;
    const res = await authFor(req, conf).api.signInSocial({ body: { provider, callbackURL }, asResponse: true }).catch(() => null);
    const go = res?.ok ? check(Social, await res.clone().json().catch(() => null)) : null;
    if (!go) return back("provider");
    const out = see(go.url, res!);
    if (ask) out.headers.append("set-cookie", socialCookie(req, await socialMark(conf, ask), 600));
    return out;
  }

  const me = await meOf(req, conf);
  if (!me) return back("in");

  if (act === "continue") return onward(conf, regionAt(req), me.id, ask);
  // The friends page (pages.tsx): the person's own hub, by cookie rather than a token. A form field left empty is left out.
  // The friend link this browser opened: "Be friends" makes the two friends at once, "No thanks" (`no`) forgets the link.
  if (act === "add") {
    const l = linkOf(cookieOf(req, ADD_COOKIE) ?? "");
    const r = l && conf.HUB && !field(form, "no") ? await hubRedeem(conf.HUB, l, { id: me.id, name: me.name }) : null;
    const out = see(r && "error" in r ? `/?tab=friends&e=${/most/.test(r.error) ? "full" : "nolink"}` : "/?tab=friends");
    out.headers.append("set-cookie", addCookie(req, "", 0));
    return out;
  }
  if (act === "befriend" || act === "accept" || act === "drop" || act === "clear" || act === "relink") {
    if (!conf.HUB) return see("/?tab=friends&e=nohub");
    const email = field(form, "email").trim(), id = field(form, "id");
    const r = await hubAsk(conf.HUB, atHome(me), { op: act, ...(email ? { email } : {}), ...(id ? { id } : {}) });
    return see("error" in r ? `/?tab=friends&e=${/most|too many/.test(r.error) ? "full" : "hub"}` : "/?tab=friends");
  }
  // The Account tab's ways to sign in: add GitHub, Google or Apple to this account (off to the provider and back, signed in
  // as themselves throughout), or take one off. Better Auth refuses to take off the last one.
  if (act === "link") {
    if (await limited()) return see("/?tab=account&e=slow");
    const provider = check(oneOf(["github", "google", "apple"]), field(form, "provider"));
    if (!provider || !providers(conf).includes(provider)) return see("/?tab=account&e=provider");
    const res = await authFor(req, conf).api.linkSocialAccount({ body: { provider, callbackURL: "/?tab=account", errorCallbackURL: "/?tab=account&e=link" }, headers: req.headers, asResponse: true }).catch(() => null);
    const go = res?.ok ? check(Social, await res.clone().json().catch(() => null)) : null;
    return go ? see(go.url, res!) : see("/?tab=account&e=provider");
  }
  if (act === "unlink") {
    const res = await authFor(req, conf).api.unlinkAccount({ body: { accountId: field(form, "id") }, headers: req.headers, asResponse: true }).catch(() => null);
    return see(res?.ok ? "/?tab=account" : "/?tab=account&e=last");
  }
  if (act === "logout") await signOutApps(conf, me.id);
  if (act === "logout") return see(ask ? `/login?${askQuery(ask)}` : "/login", await authFor(req, conf).api.signOut({ headers: req.headers, asResponse: true }));
  // The Studio tab (Studio.tsx): add someone by email, or make a studio. The same rules as eq_studio_add and eq_studio_make.
  if (act === "studio-add") {
    const role = check(Role, field(form, "role"));
    if (!role) return see("/?tab=studio&e=studio");
    const r = await addMember(conf, field(form, "studio"), me.id, field(form, "email"), role);
    return see(r.ok ? "/?tab=studio" : `/?tab=studio&e=${r.status === 404 ? "nobody" : "studio"}`);
  }
  if (act === "studio-remove") {
    const r = await studioRemove(conf, field(form, "studio"), me.id, field(form, "email"));
    return see(r.ok ? "/?tab=studio" : "/?tab=studio&e=studio");
  }
  // The studio's own Qollab space (space.ts): its owner or admin makes it once; its members are the studio's.
  if (act === "studio-space") {
    const studio = field(form, "studio"), name = check(SPACE_NAME, field(form, "name").trim());
    if (!name) return see("/?tab=studio&e=name");
    const r = await makeSpace(conf, me.id, name, studio);
    return see(r.ok ? "/spaces" : "/?tab=studio&e=studio");
  }
  if (act === "studio-make") {
    const name = check(STUDIO_NAME, field(form, "name").trim()), kind = check(Kind, field(form, "kind"));
    if (!name || !kind) return see("/?tab=studio&e=name");
    const r = await makeStudio(conf, me.id, name, kind);
    return see(r.ok ? "/?tab=studio" : "/?tab=studio&e=owned");
  }
  // The Studio tab's form for a studio's own game (Studio.tsx, listings.ts): save it, send it to review, or pull it. The same rules as
  // eq_listing_save, eq_listing_send and eq_listing_pull. Origins and returns are one URL a line; an empty field is left out.
  if (act === "listing-save" || act === "listing-send" || act === "listing-pull") {
    const id = field(form, "id").trim(), text = (k: string) => field(form, k).trim();
    const urls = (k: string) => { const l = text(k).split(/\s+/).filter(Boolean); return l.length ? l : undefined; };
    let r: Done;
    if (act === "listing-save") {
      const d = check(Draft, { studio: text("studio"), id, name: text("name"), genre: text("genre"), origins: urls("origins") ?? [],
        ...(urls("returns") ? { returns: urls("returns") } : {}), ...(text("erase") ? { erase: text("erase") } : {}), ...(text("blurb") ? { blurb: text("blurb") } : {}) });
      if (!d) return see("/?tab=studio&e=game");
      r = await save(conf, me.id, d);
    } else r = act === "listing-send" ? await send(conf, me.id, id) : await pull(conf, me.id, false, id);
    return see(r.ok ? "/?tab=studio" : `/?tab=studio&e=${r.status === 409 ? "gamestep" : "gameowner"}`);
  }
  if (act === "grant" || act === "revoke") {
    if (!isAdmin(me, conf)) return json({ error: "only the super admin grants access" }, 403);
    const role = field(form, "role").trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(role)) return see("/?tab=people&e=role");
    const ok = await setAccess(conf, field(form, "email"), field(form, "for_app"), role, act === "grant", me.email);
    return see(ok ? "/?tab=people" : "/?tab=people&e=who");
  }
  return json({ error: "not found" }, 404);
}
