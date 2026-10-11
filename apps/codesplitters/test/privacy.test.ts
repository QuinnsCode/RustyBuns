import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { privacyNotice } from "../src/privacy.ts";

// End to end (real git, in-process D1), like tokens.test.ts.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** ryan with a private repo, a collection and a token, and a collaborator on mia's repo. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  for (const u of ["ryan", "mia"]) await send(u, "/api/login", { name: u });
  await send("ryan", "/api/repos", { name: "lab", visibility: "private" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  await send("ryan", "/api/playlists", { title: "favourite regexes" });
  await send("mia", "/api/repos", { name: "pit" });
  await call.env.DB.prepare("INSERT INTO collaborators (owner, repo, name) VALUES ('mia', 'pit', 'ryan')").run();
  await call.env.DB.prepare("INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started) VALUES ('ryan', 'lab', 'a.ts', 'claude', 'secret plans', 'agent-claude', 'done', 0)").run();
  const token = (await (await send("ryan", "/api/tokens", { label: "script", scope: "write" })).json()) as { token: string };
  const bearer = (url: string, method = "GET") => call(null, url, { method, headers: { authorization: `Bearer ${token.token}` } });
  return { call, send, token: token.token, bearer };
}

describe("your data", () => {
  test("the export has what we hold about you, and no secrets", async () => {
    const { call, token } = await app();
    const res = await call("ryan", "/api/me/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("codesplitters-ryan.json");
    const out = (await res.json()) as any;
    expect(out.handle).toBe("ryan");
    expect(out.repos.map((r: any) => r.name)).toEqual(["lab"]);
    expect(out.collaborating_on).toEqual([{ owner: "mia", repo: "pit" }]);
    expect(out.collections[0].title).toBe("favourite regexes");
    expect(out.api_tokens).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain(token);
    expect(JSON.stringify(out)).not.toContain("hash");
  });

  test("a token can't export or delete; only the person can", async () => {
    const { bearer } = await app();
    expect((await bearer("/api/me/export")).status).toBe(403);
    expect((await bearer("/api/me?confirm=ryan", "DELETE")).status).toBe(403);
  });

  test("deleting asks for the handle, then buries the account and retires the handle", async () => {
    const { call } = await app();
    expect((await call("ryan", "/api/me", { method: "DELETE" })).status).toBe(400);
    const res = await call("ryan", "/api/me?confirm=ryan", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("cs_user=;");
    expect((await call(null, "/api/users/ryan")).status).toBe(404);
    expect((await call("mia", "/api/repos/ryan/lab")).status).toBe(404);
    const db = call.env.DB;
    for (const [table, where] of [["repos", "owner"], ["collaborators", "name"], ["playlists", "owner"], ["api_tokens", "name"], ["agent_runs", "owner"]])
      expect(await db.prepare(`SELECT 1 FROM ${table} WHERE ${where} = 'ryan'`).first()).toBeNull();
    expect(await db.prepare("SELECT email FROM handle_grants WHERE handle = 'ryan'").first()).toEqual({ email: "retired:ryan" });
    // mia's repo is hers, untouched.
    expect((await call("mia", "/api/repos/mia/pit")).status).toBe(200);
  });
});

describe("GitHub and Google grants (#515)", () => {
  const origin = "http://codesplitters.local", key = "test-secret-".padEnd(40, "x");
  /** ana, signed up with email and a handle, with a GitHub and a Google sign-in linked; `fetch` answers GitHub and Google. */
  async function linked(fetch: (url: string, init: RequestInit) => Response, extra: Record<string, unknown> = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret" }) {
    const call = await boot({ GH_CLI: "off", BETTER_AUTH_SECRET: key, BETTER_AUTH_URL: origin, ...extra });
    opened.push(call);
    const res = await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "ana@example.com", password: "correct horse battery", name: "ana" }) });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect((await call(null, "/api/handle", { method: "POST", headers: { cookie }, body: JSON.stringify({ name: "ana-digger" }) })).status).toBe(201);
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const authId = (await call.env.DB.prepare("SELECT auth_id FROM users WHERE name = 'ana-digger'").first())!.auth_id as string;
    const link = async (provider: string, access: string, refresh: string | null) => call.env.DB.prepare(`INSERT INTO account (id, accountId, providerId, userId, accessToken, refreshToken, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')`)
      .bind(provider, provider + "-id", provider, authId, await symmetricEncrypt({ key, data: access }), refresh && await symmetricEncrypt({ key, data: refresh })).run();
    await link("github", "gho_ana", null);
    await link("google", "ya29.ana", "1//refresh-ana");
    const calls: { url: string; method?: string; auth?: string | null; body: string }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string, init: RequestInit = {}) => {
      calls.push({ url: String(u), method: init.method, auth: new Headers(init.headers).get("authorization"), body: String(init.body) });
      return fetch(String(u), init);
    }) as any;
    try { return { calls, res: await call(null, "/api/me?confirm=ana-digger", { method: "DELETE", headers: { cookie } }), db: call.env.DB }; }
    finally { globalThis.fetch = real; }
  }

  test("deleting the account revokes them at GitHub and Google, before the tokens go", async () => {
    const { calls, res, db } = await linked(() => new Response(null, { status: 204 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: "ana-digger" });
    const gh = calls.find((c) => c.url.includes("github"))!;
    expect([gh.url, gh.method, gh.auth, JSON.parse(gh.body)]).toEqual(["https://api.github.com/applications/cid/grant", "DELETE", `Basic ${btoa("cid:csecret")}`, { access_token: "gho_ana" }]);
    const google = calls.find((c) => c.url.includes("google"))!;
    // The refresh token, decrypted: revoking it drops the whole grant.
    expect([google.url, google.method, new URLSearchParams(google.body).get("token")]).toEqual(["https://oauth2.googleapis.com/revoke", "POST", "1//refresh-ana"]);
    expect(await db.prepare("SELECT 1 FROM account").first()).toBeNull();
  });

  test("a grant already gone counts as revoked; one that won't go is the person's to revoke, and the delete still happens", async () => {
    let r = await linked((u) => new Response(null, { status: u.includes("github") ? 404 : 400 }));
    expect(await r.res.json()).toEqual({ deleted: "ana-digger" });
    r = await linked((u) => { if (u.includes("google")) throw new Error("offline"); return new Response(null, { status: 500 }); });
    expect(await r.res.json()).toEqual({ deleted: "ana-digger", revoke_yourself: ["github", "google"] });
    expect(await r.db.prepare("SELECT 1 FROM users WHERE name = 'ana-digger'").first()).toBeNull();
    // Without GitHub's app keys there's nothing to call it with.
    r = await linked(() => new Response(null, { status: 200 }), {});
    expect((await r.res.json() as any).revoke_yourself).toEqual(["github"]);
    expect(r.calls.map((c) => c.url)).toEqual(["https://oauth2.googleapis.com/revoke"]);
  });
});

describe("the change notice", () => {
  test("PRIVACY_NOTICE reaches the page through /api/session, dated", async () => {
    const call = await boot({ GH_CLI: "off", PRIVACY_NOTICE: "2026-11-01  We'll keep request logs 3 days, not 7." });
    opened.push(call);
    expect(((await (await call(null, "/api/session")).json()) as any).notice).toEqual({ date: "2026-11-01", text: "We'll keep request logs 3 days, not 7." });
  });

  test("unset or undated means no banner", () => {
    expect(privacyNotice(undefined)).toBeNull();
    expect(privacyNotice("")).toBeNull();
    expect(privacyNotice("we changed things")).toBeNull();
    expect(privacyNotice("2026-13-45 bad date")).toBeNull();
  });
});
