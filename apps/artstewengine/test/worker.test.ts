import { expect, test } from "bun:test";
import { kv } from "@rustybuns/shell-bun";
import worker, { type Env } from "../src/worker.ts";

const env = (): Env => ({ PAYMENTS: kv(":memory:", "p") as never, ENGINE_KEY: "key-key", ADMIN_TOKEN: "admin" });
const call = (e: Env, path: string, method = "POST", body?: unknown, token?: string) =>
  worker.fetch(new Request("http://x" + path, { method, body: body ? JSON.stringify(body) : undefined, headers: token ? { authorization: `Bearer ${token}` } : {} }), e);

test("pay, get the key; revoke, bye bye", async () => {
  const e = env();
  expect((await call(e, "/lease", "POST", { license: "buddy" })).status).toBe(402);
  expect((await call(e, "/paid/buddy", "PUT", { who: "buddy" })).status).toBe(401);
  expect((await call(e, "/paid/buddy", "PUT", { who: "buddy" }, "admin")).status).toBe(200);
  const lease = await (await call(e, "/lease", "POST", { license: "buddy" })).json() as any;
  expect(lease).toMatchObject({ ok: true, key: "key-key" });
  expect((await call(e, "/paid/buddy", "DELETE", undefined, "admin")).status).toBe(200);
  expect((await call(e, "/lease", "POST", { license: "buddy" })).status).toBe(402);
});
