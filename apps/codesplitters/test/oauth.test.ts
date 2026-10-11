import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

// These run the app end to end (in-process D1): fine alone, but a full run on a
// busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const REDIRECT = "http://127.0.0.1:4788/oauth/callback";

async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  await call("ryan", "/api/login", { method: "POST", body: JSON.stringify({ name: "ryan" }) });
  await call("ryan", "/api/repos", { method: "POST", body: JSON.stringify({ name: "lab", visibility: "private" }) });
  const form = (fields: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  const token = (fields: Record<string, string>) => call(null, "/api/oauth/token", form(fields));

  /** The consent page as ryan, then his answer: the redirect back to the app. */
  async function consent(o: { client_id?: string; redirect_uri?: string; scope?: string; pick?: string; decision?: string } = {}) {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const client_id = o.client_id ?? "executor", redirect_uri = o.redirect_uri ?? REDIRECT;
    const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", ...(o.scope && { scope: o.scope }) });
    const page = await call("ryan", `/api/oauth/authorize?${q}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    const request = /name="request" value="([^"]+)"/.exec(html)![1];
    const res = await call("ryan", "/api/oauth/authorize", { ...form({ request, scope: o.pick ?? "read", decision: o.decision ?? "allow" }), headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://codesplitters.local" } });
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get("location")!);
    return { back, verifier, client_id, redirect_uri, html };
  }

  /** All the way to tokens. */
  async function signIn(o: Parameters<typeof consent>[0] = {}) {
    const c = await consent(o);
    const res = await token({ grant_type: "authorization_code", code: c.back.searchParams.get("code")!, redirect_uri: c.redirect_uri, client_id: c.client_id, code_verifier: c.verifier });
    expect(res.status).toBe(200);
    return (await res.json()) as { access_token: string; refresh_token: string; scope: string; expires_in: number };
  }
  const as = (t: string, url: string, init: RequestInit = {}) => call(null, url, { ...init, headers: { authorization: `Bearer ${t}`, ...(init.headers as Record<string, string>) } });
  return { call, form, token, consent, signIn, as };
}

describe("OAuth sign-in", () => {
  test("metadata says where to sign in, and /api/mcp's 401 points at it", async () => {
    const { call } = await app();
    const m = await (await call(null, "/.well-known/oauth-authorization-server")).json() as any;
    expect(m).toMatchObject({ issuer: "http://codesplitters.local", token_endpoint: "http://codesplitters.local/api/oauth/token", code_challenge_methods_supported: ["S256"], scopes_supported: ["read", "write"] });
    const r = await (await call(null, "/.well-known/oauth-protected-resource/api/mcp")).json() as any;
    expect(r).toMatchObject({ resource: "http://codesplitters.local/api/mcp", authorization_servers: ["http://codesplitters.local"] });
    const mcp = await call(null, "/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) });
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("www-authenticate")).toContain('resource_metadata="http://codesplitters.local/.well-known/oauth-protected-resource/api/mcp"');
    const spec = await (await call(null, "/api/openapi.json")).json() as any;
    expect(spec.components.securitySchemes.oauth.flows.authorizationCode).toMatchObject({ tokenUrl: "http://codesplitters.local/api/oauth/token", scopes: { read: expect.any(String), write: expect.any(String) } });
  });

  test("a local app signs in with PKCE and acts as you, within the scope you picked", async () => {
    const { signIn, as, call } = await app();
    const t = await signIn({ scope: "read write", pick: "read" });
    expect(t).toMatchObject({ scope: "read", expires_in: 3600 });
    expect(t.access_token).toMatch(/^cst_/);
    expect(t.refresh_token).toMatch(/^csr_/);
    expect(((await (await as(t.access_token, "/api/me")).json()) as any).name).toBe("ryan");
    expect((await as(t.access_token, "/api/repos", { method: "POST", body: JSON.stringify({ name: "nope" }) })).status).toBe(403);
    // Its token works over MCP, and isn't one of your personal tokens.
    const tools = await as(t.access_token, "/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(((await tools.json()) as any).result.tools.every((x: any) => x.annotations.readOnlyHint)).toBe(true);
    expect(await (await call("ryan", "/api/tokens")).json()).toEqual([]);
    // Tokens can't reach the grants.
    expect((await as(t.access_token, "/api/oauth/grants")).status).toBe(403);
    // A write grant writes.
    const w = await signIn({ pick: "write" });
    expect((await as(w.access_token, "/api/repos", { method: "POST", body: JSON.stringify({ name: "made" }) })).status).toBe(201);
  });

  test("a code works once, for its own verifier, client and redirect", async () => {
    const { consent, token } = await app();
    const c = await consent();
    expect(c.back.searchParams.get("state")).toBe("xyz");
    expect(c.back.searchParams.get("iss")).toBe("http://codesplitters.local");
    const code = c.back.searchParams.get("code")!;
    const wrong = await token({ grant_type: "authorization_code", code, redirect_uri: c.redirect_uri, client_id: c.client_id, code_verifier: "x".repeat(43) });
    expect(wrong.status).toBe(400);
    // That spent it.
    const again = await token({ grant_type: "authorization_code", code, redirect_uri: c.redirect_uri, client_id: c.client_id, code_verifier: c.verifier });
    expect(((await again.json()) as any).error).toBe("invalid_grant");
    const d = await consent();
    expect((await token({ grant_type: "authorization_code", code: d.back.searchParams.get("code")!, redirect_uri: d.redirect_uri, client_id: "someone-else", code_verifier: d.verifier })).status).toBe(400);
  });

  test("refresh tokens rotate, and an old one shown again ends the grant", async () => {
    const { signIn, token, as } = await app();
    const t = await signIn();
    const r1 = await token({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: "executor" });
    expect(r1.status).toBe(200);
    const n = (await r1.json()) as typeof t;
    expect(n.refresh_token).not.toBe(t.refresh_token);
    expect((await as(n.access_token, "/api/me")).status).toBe(200);
    // The first refresh token again: stolen, so everything of the grant stops.
    expect((await token({ grant_type: "refresh_token", refresh_token: t.refresh_token })).status).toBe(400);
    expect((await as(n.access_token, "/api/me")).status).toBe(401);
    expect((await token({ grant_type: "refresh_token", refresh_token: n.refresh_token })).status).toBe(400);
  });

  test("you see your apps on your profile and sign them out; revoke ends a grant too", async () => {
    const { signIn, call, as, form } = await app();
    const t = await signIn();
    const apps = (await (await call("ryan", "/api/oauth/grants")).json()) as any[];
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ client_name: "executor", scope: "read" });
    expect((await call("ryan", `/api/oauth/grants/${apps[0].id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(t.access_token, "/api/me")).status).toBe(401);

    const u = await signIn();
    expect((await call(null, "/api/oauth/revoke", form({ token: u.refresh_token }))).status).toBe(200);
    expect((await as(u.access_token, "/api/me")).status).toBe(401);
  });

  test("an app off this computer registers first, and only goes back where it said", async () => {
    const { call, consent } = await app();
    const q = (client_id: string, redirect_uri: string) => `/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id, redirect_uri, code_challenge: "a".repeat(43), code_challenge_method: "S256" })}`;
    // Unregistered and not local: a page, never a redirect.
    expect((await call("ryan", q("evil", "https://evil.example/cb"))).status).toBe(400);
    const reg = await call(null, "/api/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }) });
    expect(reg.status).toBe(201);
    const c = (await reg.json()) as { client_id: string; token_endpoint_auth_method: string };
    expect(c.token_endpoint_auth_method).toBe("none");
    expect((await call("ryan", q(c.client_id, "https://evil.example/cb"))).status).toBe(400);
    const ok = await consent({ client_id: c.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback" });
    expect(ok.html).toContain("Claude");
    expect(ok.back.origin).toBe("https://claude.ai");
    // Plain http elsewhere can't register.
    expect((await call(null, "/api/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) })).status).toBe(400);
    // No PKCE, no code.
    const noPkce = await call("ryan", `/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: "executor", redirect_uri: REDIRECT })}`);
    expect(new URL(noPkce.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
  });

  test("the consent form takes the cookie from this site only, and saying no says so", async () => {
    const { call, consent, form } = await app();
    const no = await consent({ decision: "deny" });
    expect(no.back.searchParams.get("error")).toBe("access_denied");
    const page = await call("ryan", `/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: "executor", redirect_uri: REDIRECT, code_challenge: "c".repeat(43), code_challenge_method: "S256" })}`);
    const request = /name="request" value="([^"]+)"/.exec(await page.text())![1];
    const post = (user: string | null, origin: string) => call(user, "/api/oauth/authorize", { ...form({ request, decision: "allow", scope: "write" }), headers: { "content-type": "application/x-www-form-urlencoded", origin } });
    expect((await post("ryan", "https://evil.example")).status).toBe(403);
    expect((await post("someone", "http://codesplitters.local")).status).toBe(400);
    expect((await post(null, "http://codesplitters.local")).status).toBe(400);
    // Signed out, the page asks you to sign in first.
    expect(await (await call(null, `/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: "executor", redirect_uri: REDIRECT, code_challenge: "c".repeat(43), code_challenge_method: "S256" })}`)).text()).toContain("Sign in to codeSplitters first");
  });
});
