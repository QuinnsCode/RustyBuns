import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

// created_at / updated_at come from migration 0062's triggers (#747), end to end (in-process D1).
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

async function app() {
  const call = await boot({ GH_CLI: "off", ADMINS: "boss" });
  opened.push(call);
  for (const u of ["boss", "ryan", "mia"]) await call(u, "/api/login", { method: "POST", body: JSON.stringify({ name: u }) });
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  const row = (sql: string, ...args: unknown[]) => call.env.DB.prepare(sql).bind(...args).first() as Promise<any>;
  return { call, send, row };
}

const near = (t: unknown) => typeof t === "number" && Math.abs(t - Date.now()) < 60_000;

test("a new row gets created_at, and updated_at where it's edited in place", async () => {
  const { send, row } = await app();
  await send("ryan", "/api/repos", { name: "lab" });
  await send("ryan", "/api/repos/ryan/lab/collaborators", { name: "mia" });
  const c = await row("SELECT created_at, updated_at FROM collaborators WHERE owner = 'ryan' AND repo = 'lab' AND name = 'mia'");
  expect(near(c.created_at)).toBe(true);
  expect(c.updated_at).toBe(c.created_at);
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.txt", content: "hi\n" });
  expect(near((await row("SELECT created_at FROM files WHERE owner = 'ryan' AND repo = 'lab' AND path = 'a.txt'")).created_at)).toBe(true);
});

test("updated_at moves when a setting changes, not on bookkeeping or a no-op", async () => {
  const { send, row, call } = await app();
  await send("ryan", "/api/repos", { name: "lab" });
  const repo = () => row("SELECT updated_at FROM repos WHERE owner = 'ryan' AND name = 'lab'");
  expect((await repo()).updated_at).toBeNull();
  await call.env.DB.prepare("UPDATE repos SET mirror_next_at = 1 WHERE owner = 'ryan' AND name = 'lab'").run();
  expect((await repo()).updated_at).toBeNull();
  expect((await send("ryan", "/api/repos/ryan/lab", { visibility: "private" }, "PUT")).status).toBe(200);
  expect(near((await repo()).updated_at)).toBe(true);

  // An explicit updated_at wins over the trigger.
  await call.env.DB.prepare("UPDATE users SET bio = 'hello', updated_at = 5 WHERE name = 'ryan'").run();
  expect((await row("SELECT updated_at FROM users WHERE name = 'ryan'")).updated_at).toBe(5);
  await send("ryan", "/api/me", { bio: "hello" }, "PUT");                       // same bio: no change
  expect((await row("SELECT updated_at FROM users WHERE name = 'ryan'")).updated_at).toBe(5);
  await send("ryan", "/api/me", { bio: "howdy" }, "PUT");
  expect(near((await row("SELECT updated_at FROM users WHERE name = 'ryan'")).updated_at)).toBe(true);
});

test("saving a limit rule again keeps when it was made", async () => {
  const { send, row, call } = await app();
  const put = (max: number) => send("boss", "/api/admin/limits", { rules: [{ name: "repo", max, window_s: 86400, enabled: true }] }, "PUT");
  expect((await put(3)).status).toBe(200);
  await call.env.DB.prepare("UPDATE limit_rules SET created_at = 1, updated_at = 1 WHERE name = 'repo'").run();
  expect((await put(4)).status).toBe(200);
  const r = await row("SELECT max, created_at, updated_at FROM limit_rules WHERE name = 'repo'");
  expect(r.max).toBe(4);
  expect(r.created_at).toBe(1);
  expect(near(r.updated_at)).toBe(true);
});
