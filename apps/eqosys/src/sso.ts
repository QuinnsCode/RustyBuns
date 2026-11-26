// Company sign-in (#4793): a studio's owner connects the company's own OpenID Connect provider (Google Workspace, Microsoft
// Entra, Okta), and anyone whose work email is on the company's domain signs in through it and lands in the studio with a
// role, no invite needed. eqosys is the relying party here: POST /do/sso sends them to the provider with a state, a nonce and
// PKCE; the provider sends them back to /api/auth/sso/callback (a Better Auth endpoint, so the session is Better Auth's own),
// where the code is traded for an ID token and that token is checked: its signature against the provider's JWKS, its issuer,
// audience, expiry, nonce, a verified email, and the email's domain.
//
// Their account is the one this provider made (an `account` row `sso:<studio>` holding the provider's `sub`). Until the studio
// proves it owns the domain (a DNS TXT record, proveDomain), a company sign-in never takes over an account someone made another
// way with the same email: that account signs in its usual way instead. Once proved, it links that account at its first company
// sign-in. Public mail domains are refused either way. A proved domain's studio can also make company sign-in the only way in
// for its emails (ssoOnly; auth.ts refuses any other sign-in for them).
//
// Each company sign-in renews the seat it gave (`studio_members.sso_at`); the daily sweep (lapseSeats) takes out seats not renewed
// in SSO_SEAT_DAYS, so someone the company turned off leaves the studio and its space without waiting for their session to end.
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { arr, check, nul, num, obj, opt, str, type Guard, type Of } from "@rustybuns/util/guard";
import { b64url } from "@rustybuns/util/bytes";
import { JwksKeyring, verifiedClaims } from "./jwks.ts";
import { Role, roleIn, type Made } from "./studios.ts";
import type { Env } from "./env.ts";

/** The Better Auth `providerId` of the accounts a studio's provider makes. */
export const ssoProvider = (studio: string) => `sso:${studio}`;
/** Where the provider sends people back: registered with it as the redirect URI. */
export const SSO_CALLBACK = "/api/auth/sso/callback";
/** The cookie that ties a sign-in in flight to the browser that started it. */
export const SSO_COOKIE = "eqosys.sso";
/** How long a sign-in may sit at the provider. */
export const SSO_MINUTES = 10;
/** How long a seat from company sign-in lasts without another company sign-in. */
export const SSO_SEAT_DAYS = 30;
/** Where a domain's TXT records are read: DNS over HTTPS, JSON. */
export const DOH = "https://cloudflare-dns.com/dns-query";
/** The TXT record that proves `studio` owns its company sign-in domain: put on the domain itself. */
export const proofOf = (studio: string) => `eqosys-verify=${studio}`;

const Https = str(500, { re: /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/ });
/** A company's mail domain: lower case, at least one dot. */
export const DOMAIN = str(253, { re: /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/ });
/** What the owner fills in on the Studio tab. `secret` empty keeps the one already sealed. */
export const SsoForm = obj({ issuer: Https, clientId: str(300, { min: 1 }), secret: opt(str(2000)), domain: DOMAIN, role: Role });
export type SsoForm = Of<typeof SsoForm>;

/** Mail anyone can sign up for: no company owns these, so no studio may claim one. */
const PUBLIC_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com",
  "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "mail.com", "yandex.com", "yandex.ru", "zoho.com", "fastmail.com", "hey.com",
  "qq.com", "163.com", "privaterelay.appleid.com", "example.com"]);
export const publicMail = (domain: string) => PUBLIC_MAIL.has(domain);

const Discovery = obj({ issuer: str(500), authorization_endpoint: Https, token_endpoint: Https, jwks_uri: Https });
type Discovery = Of<typeof Discovery>;
const found = new Map<string, { d: Discovery; at: number }>();
const rings = new Map<string, JwksKeyring>();

/** The provider's OpenID configuration, kept an hour an isolate. Null when it doesn't answer or names another issuer. */
export async function discover(issuer: string, now = Date.now()): Promise<Discovery | null> {
  const kept = found.get(issuer);
  if (kept && now - kept.at < 3_600_000) return kept.d;
  const res = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const d = res?.ok ? check(Discovery, await res.json().catch(() => null)) : null;
  // The issuer it says must be the one the owner typed (a trailing slash aside), or its ID tokens would never match.
  if (!d || d.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "")) return null;
  found.set(issuer, { d, at: now });
  return d;
}
const ringOf = (url: string) => { let r = rings.get(url); if (!r) { r = new JwksKeyring(url); rings.set(url, r); } return r; };

/** Whether `domain` has the TXT record `value`, read through DNS over HTTPS. A resolver that doesn't answer is a no. */
export async function hasTxt(domain: string, value: string): Promise<boolean> {
  const res = await fetch(`${DOH}?${new URLSearchParams({ name: domain, type: "TXT" })}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const body = res?.ok ? check(obj({ Answer: opt(arr(obj({ type: num(0, 65535), data: str(5000) }), 100)) }), await res.json().catch(() => null)) : null;
  // A TXT answer's data is its strings, each quoted, long ones split in pieces of 255.
  return (body?.Answer ?? []).some((a) => a.type === 16 && a.data.replace(/"\s*"/g, "").replace(/^"|"$/g, "") === value);
}

/**
 * Connects (or changes) a studio's company sign-in: its owner only. The provider must answer its discovery first. A domain
 * another studio claims is theirs, unless their claim is unproved and this studio's proof is up (proofOf): then a proved claim
 * replaces theirs. A changed domain must be proved again, and "company sign-in only" (ssoOnly) turned on again.
 */
export async function connectSso(conf: Pick<Env, "DB" | "BETTER_AUTH_SECRET">, studio: string, by: string, f: SsoForm, now = Date.now()): Promise<Made> {
  if (await roleIn(conf, studio, by) !== "owner") return { ok: false, status: 403, error: "only a studio's owner connects its company sign-in" };
  if (publicMail(f.domain)) return { ok: false, status: 400, error: `${f.domain} is public mail: use the company's own domain` };
  const other = await conf.DB.prepare("SELECT studio_id, proved_at FROM studio_sso WHERE domain = ? AND studio_id <> ?").bind(f.domain, studio).first<{ studio_id: string; proved_at: number | null }>();
  const proved = other && !other.proved_at && await hasTxt(f.domain, proofOf(studio));
  if (other && !proved) return { ok: false, status: 409, error: other.proved_at ? `another studio proved it owns ${f.domain}` : `another studio signs in ${f.domain}: publish ${proofOf(studio)} as a TXT record on it to claim it` };
  if (!await discover(f.issuer, now)) return { ok: false, status: 400, error: "that issuer has no OpenID configuration we can read" };
  const sealed = f.secret ? await symmetricEncrypt({ key: conf.BETTER_AUTH_SECRET ?? "", data: f.secret }) : null;
  await conf.DB.batch([
    ...(other ? [conf.DB.prepare("DELETE FROM studio_sso WHERE studio_id = ?").bind(other.studio_id)] : []),
    conf.DB.prepare(`INSERT INTO studio_sso (studio_id, issuer, client_id, secret, domain, role, at, proved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (studio_id) DO UPDATE SET issuer = excluded.issuer, client_id = excluded.client_id, secret = coalesce(excluded.secret, studio_sso.secret),
      proved_at = CASE WHEN studio_sso.domain = excluded.domain THEN coalesce(excluded.proved_at, studio_sso.proved_at) ELSE excluded.proved_at END,
      only_sso = CASE WHEN studio_sso.domain = excluded.domain THEN studio_sso.only_sso ELSE 0 END,
      domain = excluded.domain, role = excluded.role, at = excluded.at`).bind(studio, f.issuer, f.clientId, sealed, f.domain, f.role, now, proved ? now : null),
  ]);
  return { ok: true, id: studio };
}

/** The owner checks the studio's TXT record (proofOf) on its company sign-in domain: found, the domain is proved. */
export async function proveDomain(conf: Pick<Env, "DB">, studio: string, by: string, now = Date.now()): Promise<Made> {
  if (await roleIn(conf, studio, by) !== "owner") return { ok: false, status: 403, error: "only a studio's owner proves its domain" };
  const domain = await conf.DB.prepare("SELECT domain FROM studio_sso WHERE studio_id = ?").bind(studio).first<string>("domain");
  if (!domain) return { ok: false, status: 404, error: "connect company sign-in first" };
  if (!await hasTxt(domain, proofOf(studio))) return { ok: false, status: 400, error: `no TXT record ${proofOf(studio)} on ${domain} yet` };
  await conf.DB.prepare("UPDATE studio_sso SET proved_at = ? WHERE studio_id = ?").bind(now, studio).run();
  return { ok: true, id: studio };
}

/**
 * The owner makes company sign-in the only way in for the studio's proved domain (`on`), or not. Turned on, everyone with an
 * email there is signed out, so their next sign-in is the company's. An owner on the domain must have signed in through it
 * once first, or they would lock themselves out.
 */
export async function ssoOnly(conf: Pick<Env, "DB">, studio: string, by: string, on: boolean): Promise<Made> {
  if (await roleIn(conf, studio, by) !== "owner") return { ok: false, status: 403, error: "only a studio's owner sets who must use company sign-in" };
  const row = await conf.DB.prepare("SELECT domain, proved_at FROM studio_sso WHERE studio_id = ?").bind(studio).first<{ domain: string; proved_at: number | null }>();
  if (!row?.proved_at) return { ok: false, status: 400, error: "prove the domain first" };
  if (on) {
    const mine = await conf.DB.prepare(`SELECT u.email, EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = u.id AND a."providerId" = ?) AS linked FROM "user" u WHERE u.id = ?`)
      .bind(ssoProvider(studio), by).first<{ email: string; linked: number }>();
    if (mine && domainOf(mine.email) === row.domain && !mine.linked) return { ok: false, status: 409, error: "sign in through your company once first" };
  }
  await conf.DB.batch([
    conf.DB.prepare("UPDATE studio_sso SET only_sso = ? WHERE studio_id = ?").bind(on ? 1 : 0, studio),
    ...(on ? [conf.DB.prepare(`DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE lower(email) LIKE ?)`).bind(`%@${row.domain}`)] : []),
  ]);
  return { ok: true, id: studio };
}

/** Whether `email` may sign in only through its company: its domain is proved by a studio that made company sign-in the only way. */
export const ssoRequired = async (conf: Pick<Env, "DB">, email: string) =>
  !!await conf.DB.prepare("SELECT 1 AS y FROM studio_sso WHERE domain = ? AND proved_at IS NOT NULL AND only_sso = 1").bind(domainOf(email)).first("y");

/**
 * The daily sweep: seats from company sign-in not renewed in SSO_SEAT_DAYS go (never an owner's), and `gone` closes each one's
 * sockets in the studio's space. Someone whose only way in was that company's sign-in is signed out of eqosys too.
 */
export async function lapseSeats(conf: Pick<Env, "DB">, gone: (studio: string, user: string) => Promise<unknown>, now = Date.now()): Promise<number> {
  const { results } = await conf.DB.prepare(`DELETE FROM studio_members WHERE sso_at IS NOT NULL AND sso_at < ? AND role <> 'owner' RETURNING studio_id, user_id`)
    .bind(now - SSO_SEAT_DAYS * 86_400_000).all<{ studio_id: string; user_id: string }>();
  for (const r of results) {
    await conf.DB.prepare(`DELETE FROM "session" WHERE "userId" = ?1 AND NOT EXISTS (SELECT 1 FROM "account" WHERE "userId" = ?1 AND "providerId" NOT LIKE 'sso:%')`).bind(r.user_id).run();
    await gone(r.studio_id, r.user_id).catch(() => null);
  }
  return results.length;
}

/** Takes a studio's company sign-in off (its owner): nobody new comes in that way; who is in stays. */
export async function dropSso(conf: Pick<Env, "DB">, studio: string, by: string): Promise<Made> {
  if (await roleIn(conf, studio, by) !== "owner") return { ok: false, status: 403, error: "only a studio's owner takes its company sign-in off" };
  await conf.DB.prepare("DELETE FROM studio_sso WHERE studio_id = ?").bind(studio).run();
  return { ok: true, id: studio };
}

type Row = { studio_id: string; issuer: string; client_id: string; secret: string | null; domain: string; role: Role; proved_at: number | null };

const domainOf = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

/**
 * The first half: where to send someone whose work email is `email`, and the cookie that holds this sign-in to their browser.
 * `ask` (askQuery) is the app they were on their way to. Null when no studio signs that domain in, or its provider won't answer.
 */
export async function ssoStart(conf: Env, email: string, redirect: string, ask: string | null, now = Date.now()): Promise<{ to: string; state: string } | null> {
  const row = await conf.DB.prepare("SELECT * FROM studio_sso WHERE domain = ?").bind(domainOf(email)).first<Row>();
  const d = row && await discover(row.issuer, now);
  if (!row || !d) return null;
  const state = random(), nonce = random(), verifier = random();
  await conf.DB.batch([
    conf.DB.prepare("DELETE FROM sso_states WHERE at < ?").bind(now - SSO_MINUTES * 60_000),
    conf.DB.prepare("INSERT INTO sso_states (state, studio_id, nonce, verifier, ask, at) VALUES (?, ?, ?, ?, ?, ?)").bind(state, row.studio_id, nonce, verifier, ask, now),
  ]);
  const to = new URL(d.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: row.client_id, redirect_uri: redirect, scope: "openid email profile", state, nonce,
    code_challenge: await challenge(verifier), code_challenge_method: "S256", login_hint: email.trim() })) to.searchParams.set(k, v);
  return { to: to.href, state };
}
const challenge = async (verifier: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

const Tokens = obj({ id_token: str(8000) });
/** `aud` is one client id or a list of them. */
const audience: Guard<string[]> = (v) => typeof v === "string" ? [str(300)(v)] : arr(str(300), 10)(v);
/** Entra says a verified email with `xms_edov`; the rest with `email_verified`, some as the text "true". */
const yes: Guard<boolean> = (v) => v === true || v === "true";
const IdClaims = obj({ iss: str(500), aud: audience, azp: opt(str(300)), sub: str(255, { min: 1 }), exp: num(0, 1e11), iat: num(0, 1e11), nonce: str(200),
  email: str(320, { min: 3 }), email_verified: opt(yes), xms_edov: opt(yes), name: opt(nul(str(200))) });

/** `proved`: the studio proved it owns the domain, so an account with this email made another way is linked, not refused. */
export type SsoWho = { studio: string; role: Role; sub: string; email: string; name: string; ask: string | null; proved: boolean };
export type SsoGot = { ok: true; who: SsoWho } | { ok: false; error: string };

/**
 * The second half: the provider's answer (`code`, `state`) from the browser that holds `kept` (the cookie), traded for an ID
 * token and checked. Each state is good once. `error` is what the sign-in page says (pages.tsx messageOf).
 */
export async function ssoFinish(conf: Env, q: { code?: string | null; state?: string | null }, kept: string | null, redirect: string, now = Date.now()): Promise<SsoGot> {
  if (!q.state || !q.code || q.state !== kept) return { ok: false, error: "sso" };
  const st = await conf.DB.prepare("DELETE FROM sso_states WHERE state = ? RETURNING studio_id, nonce, verifier, ask, at").bind(q.state)
    .first<{ studio_id: string; nonce: string; verifier: string; ask: string | null; at: number }>();
  if (!st || now - st.at > SSO_MINUTES * 60_000) return { ok: false, error: "sso" };
  const row = await conf.DB.prepare("SELECT * FROM studio_sso WHERE studio_id = ?").bind(st.studio_id).first<Row>();
  const d = row && await discover(row.issuer, now);
  if (!row || !d) return { ok: false, error: "sso" };
  const secret = row.secret ? await symmetricDecrypt({ key: conf.BETTER_AUTH_SECRET ?? "", data: row.secret }).catch(() => null) : null;
  const res = await fetch(d.token_endpoint, { method: "POST", signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: q.code, redirect_uri: redirect, client_id: row.client_id, code_verifier: st.verifier, ...(secret ? { client_secret: secret } : {}) }) }).catch(() => null);
  const tokens = res?.ok ? check(Tokens, await res.json().catch(() => null)) : null;
  const c = tokens && check(IdClaims, await verifiedClaims(tokens.id_token, ringOf(d.jwks_uri), now));
  const at = now / 1000;
  if (!c || c.iss !== d.issuer || !c.aud.includes(row.client_id) || (c.aud.length > 1 && c.azp !== row.client_id) || c.exp <= at || c.iat > at + 300 || c.nonce !== st.nonce) return { ok: false, error: "sso" };
  if (!c.email_verified && !c.xms_edov) return { ok: false, error: "ssomail" };
  if (domainOf(c.email) !== row.domain) return { ok: false, error: "ssodomain" };
  return { ok: true, who: { studio: row.studio_id, role: row.role, sub: c.sub, email: c.email.trim().toLowerCase(), name: c.name?.trim() ?? "", ask: st.ask, proved: !!row.proved_at } };
}

/**
 * Puts them in the studio with its sign-in's role; someone already in keeps the role they have (an owner made them admin, say).
 * A seat this sign-in gave is renewed (`sso_at`, lapseSeats); one an owner handed out by email stays theirs for good.
 */
export const joinStudio = (conf: Pick<Env, "DB">, w: SsoWho, userId: string, now = Date.now()) =>
  conf.DB.prepare(`INSERT INTO studio_members (studio_id, user_id, role, at, sso_at) VALUES (?1, ?2, ?3, ?4, ?4)
    ON CONFLICT (studio_id, user_id) DO UPDATE SET sso_at = ?4 WHERE studio_members.sso_at IS NOT NULL`).bind(w.studio, userId, w.role, now).run();

/** A cookie holding `state` for the callback, or clearing it. */
export const ssoCookie = (secure: boolean, state: string, age = SSO_MINUTES * 60) =>
  `${SSO_COOKIE}=${state}; Path=${SSO_CALLBACK}; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
const cookieIn = (h: Headers | undefined, name: string) =>
  (h?.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;

/**
 * The callback, inside Better Auth so the session it makes is one of its own: find or make the provider's account, put them in
 * the studio, sign them in, and go on to `/login` with the app's ask (`onward` there takes it on, as after "Continue with…").
 * `mark` makes the social mark cookie (handle.ts) for that ask, so they go straight on rather than being asked to pick it again.
 */
export const ssoPlugin = (conf: Env, mark: (ask: string) => Promise<{ name: string; value: string; path: string } | null>): BetterAuthPlugin => ({
  id: "eqosys-sso",
  endpoints: {
    ssoCallback: createAuthEndpoint("/sso/callback", { method: "GET" }, async (ctx) => {
      const url = new URL(ctx.request?.url ?? `${ctx.context.baseURL}/sso/callback`), redirect = `${ctx.context.baseURL}/sso/callback`;
      const secure = url.protocol === "https:", flags = { httpOnly: true, sameSite: "lax", secure } as const;
      ctx.setCookie(SSO_COOKIE, "", { ...flags, path: SSO_CALLBACK, maxAge: 0 });
      const got = await ssoFinish(conf, { code: url.searchParams.get("code"), state: url.searchParams.get("state") }, cookieIn(ctx.headers ?? ctx.request?.headers, SSO_COOKIE), redirect);
      const login = (e?: string, ask?: string | null) => { const q = [e ? `e=${e}` : "", ask ?? ""].filter(Boolean).join("&"); return q ? `/login?${q}` : "/login"; };
      if (!got.ok) throw ctx.redirect(login(got.error));
      const w = got.who, provider = ssoProvider(w.studio);
      const owned = await conf.DB.prepare(`SELECT "userId" AS id FROM "account" WHERE "providerId" = ? AND "accountId" = ?`).bind(provider, w.sub).first<string>("id");
      let userId = owned;
      if (!userId) {
        // Someone with this email who signed up another way keeps their account: the company can't take it over, unless the studio
        // proved it owns the domain, and then the company's sign-in is linked to it.
        const had = await ctx.context.internalAdapter.findUserByEmail(w.email);
        if (had && !w.proved) throw ctx.redirect(login("ssotaken", w.ask));
        if (had) { await ctx.context.internalAdapter.linkAccount({ userId: had.user.id, providerId: provider, accountId: w.sub }); userId = had.user.id; }
      }
      if (!userId) {
        const made = await ctx.context.internalAdapter.createOAuthUser({ email: w.email, name: w.name, emailVerified: true }, { providerId: provider, accountId: w.sub });
        userId = made.user.id;
      }
      const user = await ctx.context.internalAdapter.findUserById(userId);
      if (!user) throw ctx.redirect(login("sso"));
      await joinStudio(conf, w, userId);
      const session = await ctx.context.internalAdapter.createSession(userId);
      await setSessionCookie(ctx, { session, user });
      const m = w.ask ? await mark(w.ask) : null;
      if (m) ctx.setCookie(m.name, m.value, { ...flags, path: m.path, maxAge: 600 });
      throw ctx.redirect(w.ask ? login(undefined, w.ask) : "/?tab=studio");
    }),
  },
});
