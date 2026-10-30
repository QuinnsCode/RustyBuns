// eqosys as an OpenID Connect provider, over the same handoff as /login and /api/exchange, so a site that already
// speaks OIDC (the QNTBR site's Better Auth through its generic OAuth plugin, an iOS app, any OIDC library) signs
// people in with no eqosys code of its own:
//   GET  /.well-known/openid-configuration   where everything is
//   GET  /oauth/authorize                     the app's ask in OAuth's words, on to /login (PKCE S256 is required)
//   POST /oauth/token                         a code (or a refresh token) for { access_token, id_token, refresh_token? }
//   GET  /oauth/userinfo                      who the access token is for
//   POST /oauth/revoke                        throw a refresh token away (signing out of a native app)
// A client is an app in APPS: client_id is its id, and redirect_uri must be on its origins or schemes. Clients are
// public (token_endpoint_auth_method "none"): the verifier proves the code, not a secret, so a secret sent along is ignored.
import { appOf, returnTo } from "./apps.ts";
import { askOf, askQuery, cors, issuer, see } from "./handle.ts";
import { emailVerified, exchange, mintRefresh, revokeRefresh, spendRefresh } from "./members.ts";
import { json, loopbackOn, type Env } from "./env.ts";
import { audOf, jwksOf, sign, TOKEN_S, verify, type Handoff } from "@rustybuns/util/token";
import { json as publicJson } from "@rustybuns/util/http";
import { check, obj, oneOf, opt, str } from "@rustybuns/util/guard";

const Grant = obj({
  grant_type: oneOf(["authorization_code", "refresh_token"]),
  client_id: opt(str(64)), code: opt(str(100)), code_verifier: opt(str(128, { min: 43 })), refresh_token: opt(str(100)), scope: opt(str(200)),
});

/** Where an OIDC client finds everything, from eqosys's own origin. */
export const discovery = (iss: string) => ({
  issuer: iss,
  authorization_endpoint: `${iss}/oauth/authorize`,
  token_endpoint: `${iss}/oauth/token`,
  userinfo_endpoint: `${iss}/oauth/userinfo`,
  revocation_endpoint: `${iss}/oauth/revoke`,
  jwks_uri: `${iss}/.well-known/jwks.json`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["ES256"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["openid", "email", "profile", "offline_access"],
  claims_supported: ["sub", "email", "email_verified", "name", "source", "access", "nonce"],
});

/** An OAuth error, the way RFC 6749 spells them. */
const oops = (error: string, description: string, status = 400, head: Record<string, string> = {}) =>
  json({ error, error_description: description }, status, head);

/** The body of a token or revoke request: a form, as OAuth sends it, or JSON. */
async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  if (/json/.test(req.headers.get("content-type") ?? "")) {
    const v: unknown = await req.json().catch(() => null);
    return typeof v === "object" && v && !Array.isArray(v) ? { ...v } : {};
  }
  const form = await req.formData().catch(() => null);
  return form ? Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])) : {};
}

/** The client a request names: client_id in the body, or the user half of HTTP Basic (some clients send it there). */
function clientOf(req: Request, body: { client_id?: string }) {
  const basic = /^Basic (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  let id = body.client_id;
  if (!id && basic) try { id = decodeURIComponent(atob(basic).split(":")[0] ?? ""); } catch { /* not base64: no client */ }
  return appOf(id);
}

async function tokens(conf: Env, iss: string, who: Handoff, nonce: string | null, refresh: boolean) {
  const access = await sign(conf, iss, who);
  if (!access) return null;
  const id = await sign(conf, iss, who, Date.now(), { email_verified: await emailVerified(conf, who.user.id), ...(nonce ? { nonce } : {}) });
  return {
    access_token: access, id_token: id, token_type: "Bearer", expires_in: TOKEN_S, scope: refresh ? "openid email profile offline_access" : "openid email profile",
    ...(refresh ? { refresh_token: await mintRefresh(conf, who.user.id, who.app) } : {}),
  };
}

/** The OIDC routes, or null for a path that is none of them. */
export async function oauth(req: Request, conf: Env): Promise<Response | null> {
  const url = new URL(req.url), { pathname } = url;
  const iss = issuer(req, conf);

  if (pathname === "/.well-known/openid-configuration" && req.method === "GET")
    return publicJson(discovery(iss), 200, { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" });

  if (pathname === "/oauth/authorize" && req.method === "GET") {
    const q = url.searchParams;
    // A client or redirect that isn't one of ours gets eqosys's own error page, never a redirect to somewhere it named.
    const app = appOf(q.get("client_id")), back = app && returnTo(app, q.get("redirect_uri"), loopbackOn(conf));
    if (!app || !back) return see("/login?e=app");
    // Anything else wrong goes back to the client the way OAuth says, most likely a missing PKCE challenge.
    const fail = (error: string) => {
      back.searchParams.set("error", error);
      if (q.get("state")) back.searchParams.set("state", q.get("state")!);
      return see(back.href);
    };
    if (q.get("response_type") !== "code") return fail("unsupported_response_type");
    const names: Record<string, string> = { app: "client_id", return: "redirect_uri", challenge: "code_challenge" };
    const ask = q.get("code_challenge_method") === "S256" ? askOf((k) => q.get(names[k] ?? k), conf) : null;
    return ask && ask !== "bad" ? see(`/login?${askQuery(ask)}`) : fail("invalid_request");
  }

  if (pathname === "/oauth/token") {
    const head = cors(req, conf);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "POST") return oops("invalid_request", "POST a form", 405, head);
    const raw = await bodyOf(req);
    const body = check(Grant, raw);
    if (!body) return oops(raw.grant_type && !["authorization_code", "refresh_token"].includes(String(raw.grant_type)) ? "unsupported_grant_type" : "invalid_request", "send grant_type and its fields", 400, head);
    const app = clientOf(req, body);
    if (!app) return oops("invalid_client", "client_id is an app in eqosys's APPS", 401, head);
    if (!(await jwksOf(conf)).keys.length) return oops("temporarily_unavailable", "eqosys has no signing key yet", 503, head);

    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.code_verifier) return oops("invalid_request", "send code and code_verifier", 400, head);
      const traded = await exchange(conf, app.id, body.code, body.code_verifier);
      if (!traded) return oops("invalid_grant", "that code is used, late, for another client, or the verifier is wrong", 400, head);
      // Native apps ask for offline_access and keep the refresh token; a site with its own sessions doesn't need one.
      const out = await tokens(conf, iss, traded.who, traded.nonce, /\boffline_access\b/.test(body.scope ?? ""));
      return out ? json(out, 200, head) : oops("temporarily_unavailable", "eqosys has no signing key yet", 503, head);
    }
    if (!body.refresh_token) return oops("invalid_request", "send refresh_token", 400, head);
    const who = await spendRefresh(conf, app.id, body.refresh_token);
    if (!who) return oops("invalid_grant", "that refresh token is spent, late, revoked or another client's", 400, head);
    const out = await tokens(conf, iss, who, null, true);
    return out ? json(out, 200, head) : oops("temporarily_unavailable", "eqosys has no signing key yet", 503, head);
  }

  if (pathname === "/oauth/userinfo") {
    const head = cors(req, conf);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    const token = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    const app = token ? appOf(audOf(token)) : undefined;
    const claims = token && app ? await verify(token, await jwksOf(conf), { iss, aud: app.id }) : null;
    if (!claims) return json({ error: "invalid_token" }, 401, { ...head, "www-authenticate": 'Bearer error="invalid_token"' });
    const { sub, email, name, source, access } = claims;
    return json({ sub, email, email_verified: await emailVerified(conf, sub), name, source, access }, 200, head);
  }

  if (pathname === "/oauth/revoke" && req.method === "POST") {
    const body = await bodyOf(req);
    // RFC 7009: the answer is 200 whether or not the token was there, so it tells a guesser nothing.
    if (typeof body.token === "string" && body.token.length <= 100) await revokeRefresh(conf, body.token);
    return json({}, 200, cors(req, conf));
  }

  return null;
}
