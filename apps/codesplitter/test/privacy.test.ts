import { describe, expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";
import { privacyNotice } from "../src/privacy.ts";

// End to end (real git, in-process D1), like tokens.test.ts.

/** ryan with a private repo, a collection and a token, and a collaborator on mia's repo. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
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
    expect(res.headers.get("content-disposition")).toContain("codesplitter-ryan.json");
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

describe("deleting with accounts on (#513)", () => {
  const origin = "http://codesplitter.local";
  test("the Better Auth rows go, the handle is retired, and the old cookie is no one", async () => {
    const call = await boot({ GH_CLI: "off", BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: origin });
    const res = await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "ana@example.com", password: "correct horse battery", name: "ana" }) });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect((await call(null, "/api/handle", { method: "POST", headers: { cookie }, body: JSON.stringify({ name: "ana-digger" }) })).status).toBe(201);
    const db = call.env.DB;
    const id = (await db.prepare("SELECT auth_id FROM users WHERE name = 'ana-digger'").first())!.auth_id as string;
    // A reset link waiting in the inbox, keyed to the account.
    await db.prepare(`INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES ('v1', 'reset-password:tok', ?, '2099-01-01', '2026-01-01', '2026-01-01')`).bind(id).run();
    for (const t of ["session", "account"]) expect(await db.prepare(`SELECT 1 FROM ${t} WHERE "userId" = ?`).bind(id).first()).not.toBeNull();

    const gone = await call(null, "/api/me?confirm=ana-digger", { method: "DELETE", headers: { cookie } });
    expect(gone.status).toBe(200);
    expect(gone.headers.getSetCookie().filter((c) => c.startsWith("better-auth.session_token=;"))).toHaveLength(1);
    for (const t of ["session", "account"]) expect(await db.prepare(`SELECT 1 FROM ${t} WHERE "userId" = ?`).bind(id).first()).toBeNull();
    expect(await db.prepare(`SELECT 1 FROM verification WHERE identifier = 'ana@example.com' OR value = ?`).bind(id).first()).toBeNull();
    expect(await db.prepare(`SELECT 1 FROM "user" WHERE id = ?`).bind(id).first()).toBeNull();
    expect(await db.prepare("SELECT email FROM handle_grants WHERE handle = 'ana-digger'").first()).toEqual({ email: "retired:ana-digger" });
    // The cookie the browser held before is no one now, and the handle can't be claimed again.
    expect(((await (await call(null, "/api/session", { headers: { cookie } })).json()) as any).user).toBeNull();
    expect(((await (await call(null, "/api/handle?name=ana-digger")).json()) as any).ok).toBe(false);
  });

  test("in alias mode a retired handle, or @ghost, can't be signed in as again", async () => {
    const { call } = await app();
    await call("ryan", "/api/me?confirm=ryan", { method: "DELETE" });
    for (const name of ["ryan", "ghost"]) expect((await call(null, "/api/login", { method: "POST", body: JSON.stringify({ name }) })).status).toBe(409);
    expect((await call(null, "/api/login", { method: "POST", body: JSON.stringify({ name: "ryan2" }) })).status).toBe(200);
  });

  test("an alias cookie this DB never saw (another 127.0.0.1 port's) is made a user, unless it's retired (#1274)", async () => {
    const { call } = await app();
    expect(await (await call("ana", "/api/session")).json()).toMatchObject({ mode: "alias", user: "ana" });
    expect(await (await call("ana", "/api/me")).json()).toMatchObject({ name: "ana" });
    await call("ryan", "/api/me?confirm=ryan", { method: "DELETE" });
    expect(await (await call("ryan", "/api/session")).json()).toMatchObject({ user: null });
  });
});

describe("@ghost in other people's repos (#514)", () => {
  /** ryan, crew on mia's pit, wrote a file there, committed it, and edited it on a branch of his. */
  async function worked() {
    const a = await app();
    const { call, send } = a;
    await send("ryan", "/api/repos/mia/pit/files", { path: "b.ts", content: "ryan's line" });
    await send("ryan", "/api/repos/mia/pit/do/commit?path=b.ts", { message: "ryan's commit" });
    await send("mia", "/api/repos/mia/pit/files", { path: "c.ts", content: "mia's line" });
    expect((await send("ryan", "/api/repos/mia/pit/branches", { name: "ryan-idea" })).status).toBeLessThan(300);
    expect((await send("ryan", "/api/repos/mia/pit/do/ops?path=b.ts&branch=ryan-idea", { ops: [{ kind: "insert", after: null, text: "on the branch" }] })).status).toBe(200);
    const look = async () => {
      const file = (await (await call("mia", "/api/repos/mia/pit/do/file?path=b.ts")).json()) as any;
      const log = ((await (await call("mia", "/api/repos/mia/pit/do/log?path=b.ts&since=0")).json()) as { ops: any[] }).ops;
      const commits = (await (await call("mia", "/api/repos/mia/pit/do/commits?path=b.ts")).json()) as any[];
      const branch = (await (await call("mia", "/api/repos/mia/pit/do/file?path=b.ts&branch=ryan-idea")).json()) as any;
      const mias = (await (await call("mia", "/api/repos/mia/pit/do/file?path=c.ts")).json()) as any;
      const row = await call.env.DB.prepare("SELECT by FROM branches WHERE owner = 'mia' AND repo = 'pit' AND name = 'ryan-idea'").first();
      return { lines: file.lines.map((l: any) => l.by), log: [...new Set(log.map((o) => o.by))], commits: commits.map((c) => c.by),
        branch: [...new Set(branch.lines.map((l: any) => l.by))], mias: mias.lines.map((l: any) => l.by), row: row?.by };
    };
    expect(await look()).toEqual({ lines: ["ryan"], log: ["ryan"], commits: ["ryan"], branch: ["ryan"], mias: ["mia"], row: "ryan" });
    return { ...a, look };
  }
  const ghosted = { lines: ["ghost"], log: ["ghost"], commits: ["ghost"], branch: ["ghost"], mias: ["mia"], row: "ghost" };

  test("left alone, a deleted handle stays on what it wrote, and the delete notes where", async () => {
    const { call, look } = await worked();
    await call("ryan", "/api/me?confirm=ryan", { method: "DELETE" });
    expect((await look()).lines).toEqual(["ryan"]);
    expect(await call.env.DB.prepare("SELECT repos FROM retired_handles WHERE handle = 'ryan'").first()).toEqual({ repos: JSON.stringify([["mia", "pit"]]) });
  });

  test("asked for at the delete, @ghost takes its place on lines, ops, commits and branches", async () => {
    const { call, look } = await worked();
    expect((await call("ryan", "/api/me?confirm=ryan&scrub=1", { method: "DELETE" })).status).toBe(200);
    expect(await look()).toEqual(ghosted);
    expect(await call.env.DB.prepare("SELECT repos, scrubbed_at IS NOT NULL AS done FROM retired_handles WHERE handle = 'ryan'").first()).toEqual({ repos: "[]", done: 1 });
  });

  test("an admin can scrub one later, only a deleted account's handle", async () => {
    const { call, send, look } = await worked();
    await call("ryan", "/api/me?confirm=ryan", { method: "DELETE" });
    expect((await send("mia", "/api/admin/scrub", { handle: "mia" })).status).toBe(404);
    expect((await send("mia", "/api/admin/scrub", { handle: "ghost" })).status).toBe(404);
    const res = await send("mia", "/api/admin/scrub", { handle: "ryan" });
    expect(await res.json()).toEqual({ handle: "ryan", as: "ghost", repos: 1, files: 2 });
    expect(await look()).toEqual(ghosted);
  });

  test("lines found by who wrote them, after the crew row and line events are gone (#748)", async () => {
    const { call, send } = await app();
    await send("ryan", "/api/repos/mia/pit/files", { path: "b.ts", content: "ryan's line" });
    const db = call.env.DB, row = () => db.prepare("SELECT handle FROM authors WHERE owner = 'mia' AND repo = 'pit' AND handle = 'ryan'").first();
    for (let i = 0; i < 50 && !(await row()); i++) await Bun.sleep(10);
    expect(await row()).toEqual({ handle: "ryan" });
    // Off the crew, and the feed swept: only the file DO's authors remember him there.
    await db.batch([db.prepare("DELETE FROM collaborators WHERE name = 'ryan'"), db.prepare("DELETE FROM line_events")]);
    await call("ryan", "/api/me?confirm=ryan", { method: "DELETE" });
    expect(await db.prepare("SELECT repos FROM retired_handles WHERE handle = 'ryan'").first()).toEqual({ repos: JSON.stringify([["mia", "pit"]]) });
    expect(await (await send("mia", "/api/admin/scrub", { handle: "ryan" })).json()).toEqual({ handle: "ryan", as: "ghost", repos: 1, files: 1 });
    const file = (await (await call("mia", "/api/repos/mia/pit/do/file?path=b.ts")).json()) as any;
    expect(file.lines.map((l: any) => l.by)).toEqual(["ghost"]);
    expect((await db.prepare("SELECT handle FROM authors WHERE owner = 'mia' AND repo = 'pit' ORDER BY handle").all()).results).toEqual([{ handle: "ghost" }]);
  });

  test("the backfill wakes every file, main's and each branch's, a page at a time (#770)", async () => {
    const { call, send } = await worked();
    const db = call.env.DB, authors = async () => (await db.prepare("SELECT owner, repo, handle FROM authors ORDER BY owner, repo, handle").all()).results;
    const want = [{ owner: "mia", repo: "pit", handle: "mia" }, { owner: "mia", repo: "pit", handle: "ryan" }, { owner: "ryan", repo: "lab", handle: "ryan" }];
    for (let i = 0; i < 50 && (await authors()).length < want.length; i++) await Bun.sleep(10);
    // As if none of them had woken since #748, and only the branch's copy has b.ts.
    await db.batch([db.prepare("DELETE FROM authors"), db.prepare("DELETE FROM files WHERE owner = 'mia' AND path = 'b.ts'")]);
    const { backfillAuthors } = await import("../src/privacy.ts");
    let next: Awaited<ReturnType<typeof backfillAuthors>>["next"] = null, woken = 0;
    do { const page = await backfillAuthors(call.env, next, 1); woken += page.woken; next = page.next; } while (next);
    const files = (await db.prepare("SELECT (SELECT COUNT(*) FROM files) + (SELECT COUNT(*) FROM branch_files) AS n").first()) as { n: number };
    expect(woken).toBe(files.n);
    expect(await authors()).toEqual(want);
    // The route does the same, all in one page here.
    await db.prepare("DELETE FROM authors").run();
    expect(await (await send("mia", "/api/admin/scrub/backfill", {})).json()).toEqual({ woken: files.n, next: null });
    expect(await authors()).toEqual(want);
  });

  test("a repo's authors go with it", async () => {
    const { call } = await app();
    const db = call.env.DB, rows = () => db.prepare("SELECT 1 FROM authors WHERE owner = 'ryan' AND repo = 'lab'").first();
    for (let i = 0; i < 50 && !(await rows()); i++) await Bun.sleep(10);
    expect(await rows()).not.toBeNull();
    await call("ryan", "/api/me?confirm=ryan", { method: "DELETE" });
    expect(await rows()).toBeNull();
  });
});

describe("GitHub and Google grants (#515)", () => {
  const origin = "http://codesplitter.local", key = "test-secret-".padEnd(40, "x");
  /** ana, signed up with email and a handle, with a GitHub and a Google sign-in linked; `fetch` answers GitHub and Google. */
  async function linked(fetch: (url: string, init: RequestInit) => Response, extra: Record<string, unknown> = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret" }) {
    const call = await boot({ GH_CLI: "off", BETTER_AUTH_SECRET: key, BETTER_AUTH_URL: origin, ...extra });
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
    expect(((await (await call(null, "/api/session")).json()) as any).notice).toEqual({ date: "2026-11-01", text: "We'll keep request logs 3 days, not 7." });
  });

  test("unset or undated means no banner", () => {
    expect(privacyNotice(undefined)).toBeNull();
    expect(privacyNotice("")).toBeNull();
    expect(privacyNotice("we changed things")).toBeNull();
    expect(privacyNotice("2026-13-45 bad date")).toBeNull();
  });
});
