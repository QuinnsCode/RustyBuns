import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { local as boot } from "../src/local.ts";

// These run the app end to end (real git, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** The app in alias mode with ryan signed in (and an admin), a private repo with a file, and ryan's tokens maker. */
async function app() {
  const call = await boot({ GH_CLI: "off", ADMINS: "ryan" });
  opened.push(call);
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "private" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo\nthree" });
  const make = async (scope: string, days?: number) => {
    const res = await send("ryan", "/api/tokens", { label: `${scope} test`, scope, ...(days && { days }) });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; token: string; scope: string; last4: string; expires_at: number };
  };
  /** Call as a bearer token, no cookie. */
  const as = (token: string, url: string, init: RequestInit = {}) =>
    call(null, url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) } });
  return { call, send, make, as };
}

describe("personal API tokens", () => {
  test("a token acts as its owner, shows once, and is stored only as a hash", async () => {
    const { call, make, as } = await app();
    const t = await make("read");
    expect(t.token).toMatch(/^cst_[A-Za-z0-9_-]{43}$/);
    expect(t.last4).toBe(t.token.slice(-4));
    expect(t.expires_at - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect(((await (await as(t.token, "/api/me")).json()) as any).name).toBe("ryan");
    // The private repo is ryan's to read, so it's the token's too; signed out, it isn't there.
    expect((await as(t.token, "/api/repos/ryan/lab/do/file?path=a.ts")).status).toBe(200);
    expect((await call(null, "/api/repos/ryan/lab/do/file?path=a.ts")).status).toBe(404);
    expect(await (await as(t.token, "/api/session")).json()).toMatchObject({ mode: "token", user: "ryan", token: { id: t.id, scope: "read" } });
    // The list never has a secret in it, and the table only a hash.
    const list = await (await call("ryan", "/api/tokens")).json() as any[];
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(t.token);
    const row = await call.env.DB.prepare("SELECT * FROM api_tokens").first();
    expect(JSON.stringify(row)).not.toContain(t.token);
  });

  test("read tokens only GET; write tokens do what their owner can", async () => {
    const { make, as } = await app();
    const read = await make("read"), write = await make("write");
    const post = (token: string, url: string, body: unknown) => as(token, url, { method: "POST", body: JSON.stringify(body) });
    const no = await post(read.token, "/api/repos", { name: "nope" });
    expect(no.status).toBe(403);
    expect(no.headers.get("www-authenticate")).toContain("insufficient_scope");
    expect((await post(write.token, "/api/repos", { name: "made" })).status).toBe(201);
    expect((await post(write.token, "/api/repos/ryan/made/files", { path: "x.ts", content: "hi" })).status).toBe(201);
    const c = await post(write.token, "/api/repos/ryan/made/do/commit?path=x.ts", { message: "from an agent" });
    expect(c.status).toBe(200);
    expect(((await c.json()) as any).by).toBe("ryan");
  });

  test("a bad, revoked or expired token is a 401, never signed out or the cookie's", async () => {
    const { call, make, as } = await app();
    const t = await make("write");
    expect((await as("cst_nonsense", "/api/me")).status).toBe(401);
    expect((await as("", "/api/me", { headers: { authorization: "Bearer" } })).status).toBe(401);
    // A wrong token next to a good cookie still fails: the bearer decides.
    expect((await call("ryan", "/api/me", { headers: { authorization: "Bearer cst_nonsense" } })).status).toBe(401);
    await call.env.DB.prepare("UPDATE api_tokens SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, t.id).run();
    expect((await as(t.token, "/api/me")).status).toBe(401);
    const u = await make("read");
    expect((await call("ryan", `/api/tokens/${u.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await as(u.token, "/api/me")).status).toBe(401);
    expect((await call("mallory", `/api/tokens/${t.id}`, { method: "DELETE" })).status).toBe(404);
  });

  test("a token is never an admin, can't touch tokens or the account, and opens no sockets", async () => {
    const { call, make, as } = await app();
    const t = await make("write");
    expect((await call("ryan", "/api/admin/limits")).status).toBe(200);
    for (const [method, url] of [["GET", "/api/admin/limits"], ["GET", "/api/admin/handles"], ["GET", "/api/tokens"], ["POST", "/api/tokens"],
      ["POST", "/api/logout"], ["POST", "/api/login"], ["GET", "/api/repos/ryan/lab/do/ws?path=a.ts"]] as const)
      expect([method, url, (await as(t.token, url, { method, body: method === "POST" ? "{}" : undefined })).status]).toEqual([method, url, 403]);
    expect((await as(t.token, "/api/levels/mitt/import", { method: "POST" })).status).toBe(403);
  });

  test("tokens count against their owner's rate limits, admin or not", async () => {
    const { send, make, as } = await app();
    const t = await make("write");
    // Only requests from the internet are counted (cf-connecting-ip). New repos: 10 a day.
    const ip = { "cf-connecting-ip": "203.0.113.9" };
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await as(t.token, "/api/repos", { method: "POST", headers: ip, body: JSON.stringify({ name: `r${i}` }) })).status);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
    // The cookie is still the admin's, and isn't limited.
    expect((await send("ryan", "/api/repos", { name: "by-cookie" })).status).toBe(201);
  });

  test("a token needs a label, a scope and 1 to 365 days, and a cookie to be made", async () => {
    const { call, send } = await app();
    for (const body of [{ scope: "read" }, { label: "x", scope: "admin" }, { label: "x", scope: "read", days: 0 }, { label: "x", scope: "read", days: 366 }, { label: "x", scope: "read", days: 1.5 }])
      expect((await send("ryan", "/api/tokens", body)).status).toBe(400);
    expect((await call(null, "/api/tokens", { method: "POST", body: JSON.stringify({ label: "x", scope: "read" }) })).status).toBe(401);
  });
});

describe("GET /api/openapi.json", () => {
  const spec = async (call: Awaited<ReturnType<typeof app>>["call"]) => (await (await call(null, "/api/openapi.json")).json()) as any;

  test("names every path parameter, and each operation once", async () => {
    const { call } = await app();
    const s = await spec(call);
    expect(s.openapi).toBe("3.1.0");
    expect(s.servers[0].url).toBe("http://codesplitters.local/api");
    const ids = Object.values(s.paths).flatMap((m: any) => Object.values(m).map((o: any) => o.operationId));
    expect(new Set(ids).size).toBe(ids.length);
    for (const [path, methods] of Object.entries(s.paths) as [string, any][])
      for (const o of Object.values(methods) as any[])
        expect(o.parameters.filter((p: any) => p.in === "path").map((p: any) => p.name)).toEqual([...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    // Executor's policy keys off these.
    const risky = Object.values(s.paths).flatMap((m: any) => Object.values(m).filter((o: any) => o["x-codesplitters-risky"]).map((o: any) => o.operationId)).sort();
    expect(risky).toEqual(["commit_file", "delete_repo", "deploy", "merge_branch"]);
  });

  test("covers every API call the palette and the home page name", async () => {
    const { call } = await app();
    const s = await spec(call);
    const html = readFileSync(join(import.meta.dir, "../src/client.html"), "utf8");
    const named = [...html.matchAll(/["`](GET|POST|PUT|DELETE) \/api(\/[^"`?]*)/g)].map(([, method, path]) => `${method} ${path!
      .replace(/\$\{c\.owner\}|:o\b/g, "{owner}").replace(/\$\{c\.repo\}|:r\b/g, "{repo}")
      .replace(/\$\{[a-z]\.slug\}|:slug/g, "{slug}").replace(/\$\{u\}/g, "{name}").replace(/branches\/:name/, "branches/{branch}").replace(/:id/g, "{id}")}`);
    expect(named.length).toBeGreaterThan(20);
    // Signing in and out, and admin pages, are the browser's: tokens can't reach them.
    const browserOnly = /^\w+ \/(auth|logout|admin)\//;
    const missing = [...new Set(named)].filter((n) => !browserOnly.test(n + "/")).filter((n) => {
      const [method, path] = n.split(" ");
      return !s.paths[path!]?.[method!.toLowerCase()];
    });
    expect(missing).toEqual([]);
  });

  test("every read in it answers a token", async () => {
    const { call, send, make, as } = await app();
    const t = await make("read");
    await send("ryan", "/api/repos/ryan/lab/branches", { name: "b" });
    const share = await (await send("ryan", "/api/repos/ryan/lab/shares", { path: "a.ts", from: 1, to: 2 })).json() as { id: string };
    const cut = await (await send("ryan", "/api/repos/ryan/lab/cuts", { pieces: [{ path: "a.ts", from: 1, to: 1 }] })).json() as { id: string };
    const pl = await (await send("ryan", "/api/playlists", { title: "faves" })).json() as { id: number };
    const s = await spec(call);
    const fill: Record<string, string> = { owner: "ryan", repo: "lab", name: "ryan", branch: "b", slug: "mitt", id: "" };
    const ids: Record<string, string> = { "/shares/{id}": share.id, "/cuts/{id}": cut.id, "/playlists/{id}": String(pl.id), "/jobs/{id}": "1" };
    const query: Record<string, string> = { path: "a.ts", rev: "1", q: "one", since: "0" };
    const answers: Record<string, number> = {};
    for (const [path, methods] of Object.entries(s.paths) as [string, any][]) {
      if (!methods.get) continue;
      const url = path.replace(/\{(\w+)\}/g, (_, k) => k === "id" ? ids[path]! : fill[k]!);
      const q = methods.get.parameters.filter((p: any) => p.in === "query").map((p: any) => `${p.name}=${query[p.name] ?? ""}`).join("&");
      answers[path] = (await as(t.token, `/api${url}${q ? `?${q}` : ""}`)).status;
    }
    // A level that isn't dug yet (409), and a job that never was (404), still answered as routes.
    expect(Object.entries(answers).filter(([p, n]) => n >= 400 && !(p.startsWith("/levels/") && n === 409) && !(p === "/jobs/{id}" && n === 404))).toEqual([]);
  });
});
