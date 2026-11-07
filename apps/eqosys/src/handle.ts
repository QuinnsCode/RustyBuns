// Everything that isn't a page: the forms, the code exchange apps call, Better Auth's own routes (social
// sign-in comes back through them) and /health. Returns null for a path that is none of these.
//
// The handoff, the way OAuth does it with PKCE, minus the parts nobody here needs yet:
//   1. the app sends the person to /login?app=<id>&return=<url on its origin>&challenge=<S256 of a verifier>&state=<anything>
//   2. they sign in or sign up here (or are already), and press Continue
//   3. eqosys sends them to <return>?code=eq_…&state=…
//   4. the app POSTs /api/exchange { app, code, verifier } and gets back who they are, where they came from and their access,
//      plus a token signed with the key at /.well-known/jwks.json that its server can pass around and check on its own
import { appOf, HOME, returnTo, type QApp } from "./apps.ts";
import { authFor, authOn, isAdmin, meOf, providers, type Me } from "./auth.ts";
import { b64url, crossSite, json, loopbackOn, VERSION, type Env } from "./env.ts";
import { hubAnnounce, hubAsk, type Who } from "./qollab/hub.ts";
import { isQollab, qollab } from "./qollab/routes.ts";
import { bearerOf, cors, issuer, tokenOf } from "./door.ts";
import { deleteAccount, exchange, link, mint, setAccess, signOutApps } from "./members.ts";
import { oauth } from "./oauth.ts";
import { appleEvents } from "./apple.ts";
import { addMember, Kind, makeStudio, Role, STUDIO_NAME } from "./studios.ts";
import { recordDeploy } from "./deploys.ts";
import { file } from "./reports.ts";
import { shownFor, unlock, unlocksOf } from "./achievements.ts";
import { AGENTS_TEXT, callTool, catalog, type Ctx } from "./tools.ts";
import { jwksOf, sign } from "@rustybuns/util/token";
import { json as publicJson } from "@rustybuns/util/http";
import { check, obj, oneOf, opt, str } from "@rustybuns/util/guard";
import { dossierHeaders, regionAt, type Region } from "@rustybuns/util/privacy";
import { exportFor, HOLDERS } from "./privacy.ts";
import { regionFor, vaultFor } from "./vault.ts";
import { beacon } from "./visitors.ts";

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
const socialMarkIn = (req: Request) =>
  (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${SOCIAL_COOKIE}=`))?.slice(SOCIAL_COOKIE.length + 1) ?? null;

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

/** Signed in: on to the app with a fresh code, or home when nobody asked. */
async function onward(conf: Env, region: Region, userId: string, ask: Ask | null, from?: Response) {
  if (!ask) { await link(conf, userId, null, region); return see("/", from); }
  const [code] = await Promise.all([mint(conf, userId, ask.app, ask.challenge, ask.back, ask.nonce), link(conf, userId, ask.app, region)]);
  const to = new URL(ask.back);
  to.searchParams.set("code", code);
  if (ask.state) to.searchParams.set("state", ask.state);
  return see(to.href, from);
}

const Signed = obj({ user: obj({ id: str(200) }) });
const Social = obj({ url: str(4000) });
const Exchange = obj({ app: str(64), code: str(100), verifier: str(128, { min: 43 }), return: opt(str(2000)) });

export async function handle(req: Request, conf: Env): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const openid = await oauth(req, conf);
  if (openid) return openid;
  // Qollab's paths go to its own Worker (apps/qollab) when it is bound, else run here: same paths, same answers.
  const q = conf.QOLLAB && isQollab(pathname) ? await conf.QOLLAB.fetch(req) : await qollab(req, conf);
  if (q) return q;

  if (pathname === "/api/exchange") {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, conf) });
    if (req.method !== "POST") return json({ error: "POST { app, code, verifier }" }, 405);
    const body = check(Exchange, await req.json().catch(() => null));
    if (!body) return json({ error: "send { app, code, verifier }" }, 400, cors(req, conf));
    const traded = await exchange(conf, body.app, body.code, body.verifier, body.return);
    if (!traded) return json({ error: "that code is used, late, for another app, or the verifier is wrong" }, 400, cors(req, conf));
    return json({ ...traded.who, token: await sign(conf, issuer(req, conf), traded.who) }, 200, cors(req, conf));
  }

  // Achievements (achievements.ts): POST /q/achieve { id } unlocks one of the token's app's, GET lists its whole catalog for the person.
  if (pathname === "/q/achieve") {
    const head = { ...cors(req, conf), "access-control-allow-methods": "GET, POST" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "POST" && req.method !== "GET") return json({ error: "POST { id } or GET, with the token as a bearer" }, 405, head);
    const t = await tokenOf(req, conf, bearerOf(req));
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    if (req.method === "GET") return json({ achievements: shownFor(t.app.id, (await unlocksOf(conf, t.who.id, t.app.id)).get(t.app.id)) }, 200, head);
    const body = check(obj({ id: str(64) }), await req.json().catch(() => null));
    if (!body) return json({ error: "send { id }" }, 400, head);
    const r = await unlock(conf, t.who.id, t.app.id, body.id);
    if (r.ok && r.new && conf.HUB) await hubAnnounce(conf.HUB, t.who, `unlocked ${r.achievement.name}`);
    return r.ok ? json({ achievement: r.achievement, new: r.new }, 200, head) : json({ error: r.error }, r.status, head);
  }

  // Privacy (privacy.ts): GET /api/privacy/export is everything eqosys holds about the person as one JSON file (GDPR's access and
  // portability); GET /api/privacy is what is kept, why and how long, plus their vault (region, consents, requests). The session
  // cookie, or an app's token as a bearer.
  if (pathname === "/api/privacy" || pathname === "/api/privacy/export") {
    const head = { ...cors(req, conf), "access-control-allow-methods": "GET" };
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
    const head = cors(req, conf);
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
    const head = cors(req, conf);
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

  // An app asking for someone already signed in here who uses it (or just picked it with "Continue with…"): straight back
  // with a code, no page. Anyone else falls through to the sign-in page.
  if (pathname === "/login" && req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const ask = askOf((k) => q.get(k), conf);
    if (ask === "bad") return see("/login?e=app");
    const me = ask ? await meOf(req, conf) : null;
    const mark = socialMarkIn(req);
    if (me && ask && await goesStraightOn(conf, me.id, ask, mark)) {
      const out = await onward(conf, regionAt(req), me.id, ask);
      if (mark) out.headers.append("set-cookie", socialCookie(req, "", 0));
      return out;
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
  if (act === "befriend" || act === "accept" || act === "drop" || act === "clear") {
    if (!conf.HUB) return see("/?tab=friends&e=nohub");
    const email = field(form, "email").trim(), id = field(form, "id");
    const r = await hubAsk(conf.HUB, atHome(me), { op: act, ...(email ? { email } : {}), ...(id ? { id } : {}) });
    return see("error" in r ? `/?tab=friends&e=${/most|too many/.test(r.error) ? "full" : "hub"}` : "/?tab=friends");
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
  if (act === "studio-make") {
    const name = check(STUDIO_NAME, field(form, "name").trim()), kind = check(Kind, field(form, "kind"));
    if (!name || !kind) return see("/?tab=studio&e=name");
    const r = await makeStudio(conf, me.id, name, kind);
    return see(r.ok ? "/?tab=studio" : "/?tab=studio&e=owned");
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
