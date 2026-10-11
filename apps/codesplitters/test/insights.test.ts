import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { classify } from "../src/insights.ts";

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
