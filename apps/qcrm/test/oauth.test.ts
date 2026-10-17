import { expect, test } from "bun:test";
import { handleApi } from "../src/api.ts";
import { hourly } from "../src/demo.ts";
import { b64url, digest } from "../src/env.ts";
import { local, person } from "./app-kit.ts";

const REDIRECT = "http://127.0.0.1:8123/callback";
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
const rpc = (method: string, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params: {} });
const requestOf = (html: string) => /name="request" value="([^"]+)"/.exec(html)![1]!;

test("an MCP client signs in with OAuth, calls a tool as the person in the one org, refreshes, and is cut off by revoking", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");

  // The 401 points the client at the sign-in.
  const denied = await app("", "/api/mcp", { method: "POST", body: rpc("tools/list") });
  expect(denied.status).toBe(401);
  expect(denied.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/api/mcp");
  const res = await (await app("", "/.well-known/oauth-protected-resource/api/mcp")).json();
  expect(res.resource).toBe("http://qcrm.local/api/mcp");
  const meta = await (await app("", "/.well-known/oauth-authorization-server")).json();
  expect(meta.code_challenge_methods_supported).toEqual(["S256"]);

  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const q = new URLSearchParams({ client_id: "claude-test", redirect_uri: REDIRECT, response_type: "code", code_challenge: b64url(await digest(verifier)), code_challenge_method: "S256", state: "xyz" });
  /** Authorize as alice, pick her org, say yes: the code the app is sent back with. */
  const authorize = async () => {
    const yes = await app(cookie, "/api/oauth/authorize", form({ request: requestOf(await (await app(cookie, `/api/oauth/authorize?${q}`)).text()), org, decision: "allow" }));
    expect(yes.status).toBe(303);
    const landed = new URL(yes.headers.get("location")!);
    expect(landed.origin + landed.pathname).toBe(REDIRECT);
    expect(landed.searchParams.get("state")).toBe("xyz");
    return landed.searchParams.get("code")!;
  };
  const exchange = (code: string, code_verifier = verifier) => app("", "/api/oauth/token", form({ grant_type: "authorization_code", code, code_verifier, client_id: "claude-test", redirect_uri: REDIRECT }));
  const refresh = (refresh_token: string) => app("", "/api/oauth/token", form({ grant_type: "refresh_token", refresh_token }));

  expect(await (await app("", `/api/oauth/authorize?${q}`)).text()).toContain("Sign in to qCRM first");
  expect(await (await app(cookie, `/api/oauth/authorize?${q}`)).text()).toContain(`value="${org}"`);

  // A wrong verifier burns the code, and a code works once.
  const code = await authorize();
  expect((await exchange(code, "x".repeat(43))).status).toBe(400);
  expect((await exchange(code)).status).toBe(400);

  const tok = await (await exchange(await authorize())).json();
  expect(tok.access_token).toMatch(/^qo_/);
  const bearer = { authorization: `Bearer ${tok.access_token}` };
  const list = await (await app("", "/api/mcp", { method: "POST", headers: bearer, body: rpc("tools/list") })).json();
  expect(list.result.tools.length).toBeGreaterThan(10);
  const me = await (await app("", "/api/me", { headers: bearer })).json();
  expect(me.user.email).toBe("alice@qcrm.test");
  expect(me.user.via).toBe("key");
  // It is no key in the org's key list, and can't make keys.
  expect(await (await app(cookie, `/api/orgs/${org}/keys`)).json()).toEqual([]);
  expect((await app("", `/api/orgs/${org}/keys`, { method: "POST", headers: bearer, body: JSON.stringify({ name: "x" }) })).status).toBe(403);

  // Refresh rotates; the old refresh token shown again ends the grant.
  const next = await (await refresh(tok.refresh_token)).json();
  expect(next.access_token).toMatch(/^qo_/);
  expect((await refresh(tok.refresh_token)).status).toBe(400);
  expect((await app("", "/api/me", { headers: { authorization: `Bearer ${next.access_token}` } })).status).toBe(401);

  // A fresh grant: listed by cookie only; an expired token is refused and swept; refreshing still works; revoking is immediate.
  const t3 = await (await exchange(await authorize())).json();
  const grants = await (await app(cookie, "/api/oauth/grants")).json();
  expect(grants).toHaveLength(1);
  expect((await app("", "/api/oauth/grants", { headers: { authorization: `Bearer ${t3.access_token}` } })).status).toBe(403);
  await app.env.DB.prepare("UPDATE api_keys SET expires_at = ? WHERE grant_id IS NOT NULL").bind(Date.now() - 1).run();
  expect((await app("", "/api/me", { headers: { authorization: `Bearer ${t3.access_token}` } })).status).toBe(401);
  await hourly(app.env);
  expect((await app.env.DB.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE grant_id IS NOT NULL").first<{ n: number }>())!.n).toBe(0);
  const t4 = await (await refresh(t3.refresh_token)).json();
  expect((await app("", "/api/me", { headers: { authorization: `Bearer ${t4.access_token}` } })).status).toBe(200);
  expect((await app(cookie, `/api/oauth/grants/${grants[0].id}`, { method: "DELETE" })).status).toBe(200);
  expect((await app("", "/api/me", { headers: { authorization: `Bearer ${t4.access_token}` } })).status).toBe(401);
});

test("an unregistered app may only come back to this computer, a registered one only to its own https URL, and a stranger's form is refused", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const challenge = b64url(await digest("v".repeat(43)));
  const ask = (client_id: string, redirect_uri: string) => `/api/oauth/authorize?${new URLSearchParams({ client_id, redirect_uri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" })}`;

  expect((await app(cookie, ask("evil", "https://evil.example/cb"))).status).toBe(400);
  const reg = await app("", "/api/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["https://client.example/cb"], client_name: "Client" }) });
  expect(reg.status).toBe(201);
  const { client_id } = await reg.json();
  expect((await app(cookie, ask(client_id, "https://other.example/cb"))).status).toBe(400);
  const consent = await app(cookie, ask(client_id, "https://client.example/cb"));
  expect(consent.status).toBe(200);
  expect(consent.headers.get("x-frame-options")).toBe("DENY");
  expect((await app("", "/api/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) })).status).toBe(400);

  // Another site posting the form with the cookie, and an org the person isn't in.
  const request = requestOf(await consent.text());
  // (`app` always sends our own Origin, so this one goes to the handler directly.)
  const cross = await handleApi(new Request("http://qcrm.local/api/oauth/authorize", { ...form({ request, org, decision: "allow" }), headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example", cookie } }), app.env);
  expect(cross.status).toBe(403);
  const stranger = await person(app, "bob@qcrm.test");
  expect((await app(cookie, "/api/oauth/authorize", form({ request, org: stranger.org, decision: "allow" }))).status).toBe(400);
  const deny = await app(cookie, "/api/oauth/authorize", form({ request, org, decision: "deny" }));
  expect(new URL(deny.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
});
