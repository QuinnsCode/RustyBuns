import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { classify } from "../src/insights.ts";
import worker from "../src/worker.ts";

// End to end (in-process D1), like privacy.test.ts.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const browser = { "cf-connecting-ip": "203.0.113.7", "user-agent": CHROME, "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" };
const curl = { "cf-connecting-ip": "198.51.100.9", "user-agent": "curl/8.7.1" };

async function app() {
  const call = await boot({ GH_CLI: "off", ADMINS: "boss" });
  opened.push(call);
  const send = (user: string | null, url: string, headers: Record<string, string>, body?: unknown, method = body === undefined ? "GET" : "POST") =>
    call(user, url, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
  for (const u of ["boss", "ryan", "mia"]) await call(u, "/api/login", { method: "POST", body: JSON.stringify({ name: u }) });
  return { call, send };
}

describe("classify", () => {
  const req = (h: Record<string, string>) => new Request("http://x/api/session", { headers: h });
  test("a browser is a person; scripts, tokens, headless and spoofed browsers are agents; crawlers are bots", () => {
    expect(classify(req(browser), ["api", "session"])).toEqual({ kind: "person", via: "browser" });
    expect(classify(req(curl), ["api", "session"])).toEqual({ kind: "agent", via: "script" });
    expect(classify(req({}), ["api", "session"])).toEqual({ kind: "agent", via: "script" });
    expect(classify(req({ ...browser, authorization: "Bearer cst_x" }), ["api", "session"])).toEqual({ kind: "agent", via: "token" });
    expect(classify(req({ "user-agent": CHROME }), ["api", "session"])).toEqual({ kind: "agent", via: "headless" });
    expect(classify(req({ ...browser, "user-agent": CHROME.replace("Chrome/", "HeadlessChrome/") }), ["api", "session"])).toEqual({ kind: "agent", via: "headless" });
    expect(classify(req({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }), ["api", "session"])).toEqual({ kind: "bot", via: "crawler" });
    expect(classify(req(browser), ["api", "mcp"])).toEqual({ kind: "agent", via: "mcp" });
    expect(classify(req({ authorization: "Bearer cst_x", "user-agent": "codesplitters-cli/1" }), ["api", "session"])).toEqual({ kind: "agent", via: "cli" });
  });
});

describe("insights", () => {
  test("people and agents are told apart, and each person's steps are noted", async () => {
    const { call, send } = await app();
    await send("ryan", "/api/session", browser);
    await send("ryan", "/api/repos", browser, { name: "lab" });
    await send("ryan", "/api/repos/ryan/lab/files", browser, { path: "a.ts", content: "one" });
    await send("mia", "/api/session", curl);
    await send(null, "/api/session", curl);
    await send(null, "/api/session", { "cf-connecting-ip": "192.0.2.1", "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0)" });
    // The desktop and the tests (no cf-connecting-ip) aren't counted.
    await call("ryan", "/api/session");

    const res = await call("boss", "/api/admin/insights");
    expect(res.status).toBe(200);
    const d = (await res.json()) as any;
    expect(d.traffic.kinds.person).toMatchObject({ hits: 3, callers: 1 });
    expect(d.traffic.kinds.agent).toMatchObject({ hits: 2, callers: 2 });
    expect(d.traffic.kinds.bot).toMatchObject({ hits: 1, callers: 1 });
    // No IP is kept: a signed-out caller is a hash.
    expect(JSON.stringify(d)).not.toContain("198.51.100.9");
    expect(d.traffic.callers.find((c: any) => c.kind === "bot").who).toMatch(/^ip:[0-9a-f]{12}$/);

    const ryan = d.users.find((u: any) => u.name === "ryan");
    expect(ryan.furthest).toBe("code");
    expect(Object.keys(ryan.steps).sort()).toEqual(["code", "joined", "repo"]);
    expect(ryan.hits).toEqual({ person: 3, agent: 0, bot: 0 });
    expect(d.users.find((u: any) => u.name === "mia").hits.agent).toBe(1);
    expect(d.steps.find((s: any) => s.step === "repo").people).toBe(1);
    expect(d.health.checks.map((c: any) => c.name)).toContain("API errors");
    expect(d.health.checks.every((c: any) => ["ok", "warn", "bad"].includes(c.state))).toBe(true);
  });

  test("MCP calls count under the token's owner, with the steps their tools take", async () => {
    const { call, send } = await app();
    const { token } = (await (await call("ryan", "/api/tokens", { method: "POST", body: JSON.stringify({ label: "mcp", scope: "write" }) })).json()) as any;
    const mcp = { ...curl, authorization: `Bearer ${token}`, "user-agent": "claude-code/2.0" };
    const tool = (name: string, args: unknown) => send(null, "/api/mcp", mcp, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    await tool("create_repo", { body: { name: "lab" } });
    await tool("add_file", { owner: "ryan", repo: "lab", body: { path: "a.ts", content: "one" } });

    const d = (await (await call("boss", "/api/admin/insights")).json()) as any;
    expect(d.traffic.callers).toEqual([expect.objectContaining({ who: "@ryan", kind: "agent", via: "mcp", hits: 2 })]);
    const ryan = d.users.find((u: any) => u.name === "ryan");
    expect(Object.keys(ryan.steps).sort()).toEqual(["code", "joined", "repo"]);
    expect(ryan.hits).toEqual({ person: 0, agent: 2, bot: 0 });
  });

  test("an edit over a file's socket is writing code, noted once a socket", async () => {
    const { call, send } = await app();
    await call("ryan", "/api/repos", { method: "POST", body: JSON.stringify({ name: "lab" }) });
    await call("ryan", "/api/repos/ryan/lab/files", { method: "POST", body: JSON.stringify({ path: "a.ts", content: "one" }) });
    const open = async (user: string, headers: Record<string, string>) => {
      const ws = ((await send(user, "/api/repos/ryan/lab/do/ws?path=a.ts", { upgrade: "websocket", ...headers })) as any).webSocket, got: any[] = [];
      ws.toBrowser = (d: string) => got.push(JSON.parse(d));
      ws.queue.splice(0);
      let id = 0;
      return async (text: string) => {
        ws.onMessage(JSON.stringify({ type: "ops", id: ++id, ops: [{ kind: "insert", after: null, text }] }));
        for (const end = performance.now() + 15_000; performance.now() < end;) { const a = got.find((m) => m.id === id); if (a) return a; await Bun.sleep(5); }
      };
    };
    const steps = async () => ((await (await call("boss", "/api/admin/insights")).json()) as any).users.find((u: any) => u.name === "ryan").steps;
    // The desktop's sockets (no cf-connecting-ip) aren't counted.
    expect((await (await open("ryan", {}))("x")).type).toBe("ack");
    expect((await steps()).code).toBeUndefined();
    const edit = await open("ryan", browser);
    expect((await edit("y")).type).toBe("ack");
    expect((await edit("z")).type).toBe("ack");
    expect((await steps()).code).toMatchObject({ n: 1 });
  });

  test("on Workers, an isolate's tallies go to D1 as one batch, a row per caller (#638)", async () => {
    const { call } = await app();
    const { env } = call;
    const writes: number[] = [], batch = env.DB.batch.bind(env.DB);
    env.DB.batch = (stmts: unknown[]) => (writes.push(stmts.length), batch(stmts));
    const held: Promise<unknown>[] = [], ctx = { waitUntil: (p: Promise<unknown>) => void held.push(p) };
    const hit = (user: string, headers: Record<string, string>, path = "/api/session", body?: unknown) => worker.fetch(new Request(`http://codesplitters.local${path}`,
      { method: body ? "POST" : "GET", headers: { ...headers, cookie: `cs_user=${user}` }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, ctx);
    for (let i = 0; i < 5; i++) await hit("ryan", browser);
    await hit("ryan", browser, "/api/repos", { name: "lab" });
    await hit("mia", curl);
    await hit("mia", curl);
    expect(writes).toEqual([]);
    await Promise.all(held);
    // ryan's and mia's hits, each joined, and ryan's repo step: five upserts in one batch, not eight batches.
    expect(writes).toEqual([5]);
    const d = (await (await call("boss", "/api/admin/insights")).json()) as any;
    expect(d.traffic.callers.find((c: any) => c.who === "@ryan")).toMatchObject({ kind: "person", hits: 6 });
    expect(d.traffic.callers.find((c: any) => c.who === "@mia")).toMatchObject({ kind: "agent", hits: 2 });
    expect(d.users.find((u: any) => u.name === "ryan").steps.repo).toMatchObject({ n: 1 });
  });

  test("a failed request isn't a step", async () => {
    const { call, send } = await app();
    await send("ryan", "/api/repos", browser, { name: "" });
    const d = (await (await call("boss", "/api/admin/insights")).json()) as any;
    expect(d.users.find((u: any) => u.name === "ryan").steps.repo).toBeUndefined();
  });

  test("only admins see it", async () => {
    const { call } = await app();
    expect((await call("ryan", "/api/admin/insights")).status).toBe(403);
    expect((await call(null, "/api/admin/insights")).status).toBe(403);
  });

  test("the alias session says admin, so the page shows the admin links (#511)", async () => {
    const session = async (call: Awaited<ReturnType<typeof boot>>, user: string | null) => (await (await call(user, "/api/session")).json()) as any;
    const { call } = await app();   // ADMINS: "boss"
    expect(await session(call, "boss")).toMatchObject({ mode: "alias", user: "boss", admin: true });
    expect(await session(call, "ryan")).not.toHaveProperty("admin");
    expect(await session(call, null)).not.toHaveProperty("admin");
    // No ADMINS: your own desktop, so you're the admin.
    const desk = await boot({ GH_CLI: "off" });
    opened.push(desk);
    await desk("ryan", "/api/login", { method: "POST", body: JSON.stringify({ name: "ryan" }) });
    expect(await session(desk, "ryan")).toMatchObject({ user: "ryan", admin: true });
    expect(await session(desk, null)).not.toHaveProperty("admin");
  });

  test("the admins' own browsing isn't counted (#512)", async () => {
    const { call, send } = await app();   // ADMINS: "boss"
    await send("boss", "/api/session", browser);
    await send("boss", "/api/repos", browser, { name: "hq" });
    await send("ryan", "/api/session", browser);
    const d = (await (await call("boss", "/api/admin/insights")).json()) as any;
    expect(d.traffic.callers.map((c: any) => c.who)).toEqual(["@ryan"]);
    expect(d.users.find((u: any) => u.name === "boss").steps).toEqual({});
  });

  test("everyone has a join date, from when their handle was made (#512)", async () => {
    const { call } = await app();
    // mia signed in, but never through the internet, so she has no steps: her row says when.
    const d = (await (await call("boss", "/api/admin/insights")).json()) as any;
    const mia = d.users.find((u: any) => u.name === "mia");
    expect(mia.steps).toEqual({});
    expect(Math.abs(mia.joined - Date.now())).toBeLessThan(60_000);
  });

  test("migration 0056 dates accounts from before by Better Auth's createdAt, ISO text or a number", async () => {
    const { call } = await app();
    const db = call.env.DB;
    await db.prepare(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('a1', 'Old', 'old@example.com', 1, '2025-03-04T05:06:07.890Z', '2025-03-04'), ('a2', 'Num', 'num@example.com', 1, 1700000000000, 1700000000000)`).run();
    await db.prepare("INSERT INTO users (name, auth_id) VALUES ('old-timer', 'a1'), ('numbers', 'a2'), ('later', NULL)").run();
    // old-timer came back after #509, so has a later 'joined' already; numbers has none.
    await db.prepare("INSERT INTO user_steps (name, step, first_at, last_at, n) VALUES ('old-timer', 'joined', 1800000000000, 1800000000000, 1)").run();
    const sql = await Bun.file(`${import.meta.dir}/../migrations/0056_join_dates_and_ghost.sql`).text();
    for (const stmt of sql.replace(/--.*$/gm, "").split(";").map((x) => x.trim()).filter((x) => /^(UPDATE users|INSERT INTO user_steps)/.test(x))) await db.prepare(stmt).run();
    const joined = async (name: string) => (await db.prepare("SELECT first_at FROM user_steps WHERE name = ? AND step = 'joined'").bind(name).first())?.first_at;
    expect(await joined("old-timer")).toBe(Date.parse("2025-03-04T05:06:07.890Z"));
    expect(await joined("numbers")).toBe(1700000000000);
    expect(await joined("later")).toBeUndefined();
  });

  test("your usage is in your export, and goes when you do", async () => {
    const { call, send } = await app();
    await send("ryan", "/api/repos", browser, { name: "lab" });
    const out = (await (await call("ryan", "/api/me/export")).json()) as any;
    expect(out.usage[0]).toMatchObject({ kind: "person", via: "browser" });
    expect(out.steps.map((s: any) => s.step).sort()).toEqual(["joined", "repo"]);
    expect((await send("ryan", "/api/me?confirm=ryan", browser, undefined, "DELETE")).status).toBe(200);
    const left = await call.env.DB.prepare("SELECT (SELECT COUNT(*) FROM traffic WHERE who = '@ryan') + (SELECT COUNT(*) FROM user_steps WHERE name = 'ryan') AS n").first();
    expect(left?.n).toBe(0);
  });
});
