// eqosys as an OpenID provider (src/oauth.ts): the QNTBR site's own Better Auth signing in through it, and a
// native app's round with a refresh token.
import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { applyD1Migrations, d1 } from "@rustybuns/shell-bun";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { join } from "node:path";
import { handle } from "../src/handle.ts";
import { challengeOf, members } from "../src/members.ts";
import { boot, ORIGIN, PASSWORD } from "./kit.ts";
import { newKey } from "@rustybuns/util/token";
import { check, obj, opt, str } from "@rustybuns/util/guard";

setDefaultTimeout(30_000);

const QNTBR = "https://qntbr.com";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const Tokens = obj({ access_token: str(4000), id_token: str(4000), token_type: str(20), refresh_token: opt(str(100)) });

test("the QNTBR site's Better Auth signs a person in with eqosys as its OpenID provider", async () => {
  const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
  // Everything the site's server fetches from eqosys (discovery, JWKS, token, userinfo) lands on eqosys's own routes.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    return req.url.startsWith(ORIGIN) ? (await handle(req, conf))! : realFetch(req);
  }) as typeof fetch;

  // The site, as qbear3 configures it: its own accounts in its own database, eqosys as one more provider.
  const siteDb = d1(":memory:");
  await applyD1Migrations(siteDb as never, join(import.meta.dir, "../migrations"));
  const site = betterAuth({
    database: siteDb as never, secret: "qntbr-test-secret".padEnd(40, "x"), baseURL: QNTBR, trustedOrigins: [QNTBR],
    plugins: [genericOAuth({ config: [{
      providerId: "eqosys", clientId: "qntbr", discoveryUrl: `${ORIGIN}/.well-known/openid-configuration`,
      pkce: true, scopes: ["openid", "email", "profile"], tokenEndpointAuth: { method: "none" },
    }] })],
  });

  // "Sign in with eqosys" on the site: off to eqosys's authorize, which hands on to its login page with the ask.
  const start = await site.api.signInSocial({ body: { provider: "eqosys", callbackURL: "/" }, asResponse: true });
  const siteCookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const { url } = check(obj({ url: str(4000) }), await start.json())!;
  expect(url.startsWith(`${ORIGIN}/oauth/authorize?`)).toBe(true);
  const login = new URL((await call(url.slice(ORIGIN.length))).to, ORIGIN);
  expect(login.pathname).toBe("/login");
  expect(login.searchParams.get("app")).toBe("qntbr");
  expect(login.searchParams.get("nonce")).toBeTruthy();

  // She signs up at eqosys and comes back to the site's callback, where Better Auth checks the id_token and makes her session.
  const up = await call("/do/signup", { form: { ...Object.fromEntries(login.searchParams), name: "Ada", email: "ada@example.com", password: PASSWORD } });
  expect(up.to.startsWith(`${QNTBR}/api/auth/callback/eqosys?`)).toBe(true);
  const back = await site.handler(new Request(up.to, { headers: { cookie: siteCookie } }));
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe("/");
  const session = await site.api.getSession({ headers: new Headers({ cookie: back.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") }) });
  expect(session?.user).toMatchObject({ email: "ada@example.com", name: "Ada", emailVerified: false });

  // eqosys knows she came in through the site and gave her the site's starting access.
  expect((await members(conf)).map((m) => [m.email, m.source, m.apps.map((a) => a.access)])).toEqual([["ada@example.com", "qntbr", [["member"]]]]);
});

test("a native app: its own scheme, a refresh token it keeps, signing out, and deleting the account", async () => {
  const { call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
  const app = "park-hide-seek", redirect = "com.quinnscode.parkhideseek:/eqosys";
  const verifier = "n".repeat(43);
  const authorize = (q: Record<string, string>) => call(`/oauth/authorize?${new URLSearchParams({
    response_type: "code", client_id: app, redirect_uri: redirect, code_challenge_method: "S256", state: "st", scope: "openid offline_access", ...q })}`);

  const login = new URL((await authorize({ code_challenge: await challengeOf(verifier) })).to, ORIGIN);
  const up = await call("/do/signup", { form: { ...Object.fromEntries(login.searchParams), name: "Ada", email: "ada@example.com", password: PASSWORD } });
  const back = new URL(up.to);
  expect(`${back.protocol}${back.pathname}`).toBe(redirect);
  expect(back.searchParams.get("state")).toBe("st");

  const post = async (o: Record<string, string>) => {
    const res = await call("/oauth/token", { form: { client_id: app, ...o } });
    return { status: res.res.status, body: await res.res.json() };
  };
  const got = await post({ grant_type: "authorization_code", code: back.searchParams.get("code")!, code_verifier: verifier, scope: "openid offline_access" });
  expect(got.status).toBe(200);
  const first = check(Tokens, got.body)!;
  expect(first.refresh_token).toBeTruthy();

  // Who the access token is for, as any OIDC library asks.
  const info = await call("/oauth/userinfo", { bearer: first.access_token });
  expect(await info.res.json()).toMatchObject({ email: "ada@example.com", name: "Ada", source: app, access: ["play"], email_verified: false });

  // A refresh hands out the next refresh token; the spent one is refused after.
  const next = check(Tokens, (await post({ grant_type: "refresh_token", refresh_token: first.refresh_token! })).body)!;
  expect(next.refresh_token).not.toBe(first.refresh_token);
  expect((await post({ grant_type: "refresh_token", refresh_token: first.refresh_token! })).body).toMatchObject({ error: "invalid_grant" });

  // Signing out throws it away; deleting the account takes every one with it.
  expect((await call("/oauth/revoke", { form: { token: next.refresh_token! } })).res.status).toBe(200);
  expect((await post({ grant_type: "refresh_token", refresh_token: next.refresh_token! })).body).toMatchObject({ error: "invalid_grant" });
  const again = new URL((await authorize({ code_challenge: await challengeOf(verifier) })).to, ORIGIN);
  // The QNTBR site's own session cookie rides along on all of .qntbr.com; eqosys's has its own name and still reads.
  const cont = await call("/do/continue", { form: Object.fromEntries(again.searchParams), cookie: `better-auth.session_token=the-sites.sig; ${up.cookie}` });
  const kept = check(Tokens, (await post({ grant_type: "authorization_code", code: new URL(cont.to).searchParams.get("code")!, code_verifier: verifier, scope: "offline_access" })).body)!;
  expect((await call("/api/account/delete", { bearer: kept.access_token, json: {} })).res.status).toBe(200);
  expect((await post({ grant_type: "refresh_token", refresh_token: kept.refresh_token! })).body).toMatchObject({ error: "invalid_grant" });
});

test("an OpenID ask that isn't right goes nowhere it names", async () => {
  const { call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
  const ok = { response_type: "code", client_id: "qntbr", redirect_uri: `${QNTBR}/api/auth/callback/eqosys`, code_challenge: "c".repeat(43), code_challenge_method: "S256", state: "st" };
  const to = async (q: Record<string, string>) => (await call(`/oauth/authorize?${new URLSearchParams(q)}`)).to;
  // An unknown client, or a redirect off the client's origins: eqosys's own error, no redirect there.
  for (const q of [{ ...ok, client_id: "nope" }, { ...ok, redirect_uri: "https://evil.example/cb" }, { ...ok, redirect_uri: "com.evil.app:/cb" }])
    expect(await to(q)).toBe("/login?e=app");
  // The client is real but asked wrong (no PKCE, or not a code): it hears why, with its state.
  for (const [q, error] of [[{ ...ok, code_challenge_method: "plain" }, "invalid_request"], [{ ...ok, response_type: "token" }, "unsupported_response_type"]] as const) {
    const back = new URL(await to(q));
    expect([back.origin, back.searchParams.get("error"), back.searchParams.get("state")]).toEqual([QNTBR, error, "st"]);
  }
  // At the token endpoint: no client, a made-up code, a grant it doesn't do.
  for (const [body, error] of [
    [{ grant_type: "authorization_code", code: "eq_x", code_verifier: "v".repeat(43) }, "invalid_client"],
    [{ grant_type: "authorization_code", client_id: "qntbr", code: "eq_x", code_verifier: "v".repeat(43) }, "invalid_grant"],
    [{ grant_type: "password", client_id: "qntbr" }, "unsupported_grant_type"],
  ] as const) expect(await (await call("/oauth/token", { form: body })).res.json()).toMatchObject({ error });
  expect((await call("/oauth/userinfo", { bearer: "a.b.c" })).res.status).toBe(401);
});
