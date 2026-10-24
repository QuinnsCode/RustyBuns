import { expect, setDefaultTimeout, test } from "bun:test";
import { applyD1Migrations, d1 } from "@rustybuns/shell-bun";
import { join } from "node:path";
import { handle } from "../src/handle.ts";
import { listLicenses, metrics } from "../src/licenses.ts";
import type { Env } from "../src/env.ts";

setDefaultTimeout(30_000);

const ORIGIN = "http://stew.local";
const ADMIN = "boss@example.com", PASSWORD = "correct horse battery";

async function boot() {
  const conf: Env = { DB: d1(":memory:") as never, BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: ORIGIN, ADMIN_EMAIL: ADMIN, ENGINE_KEY: "engine-key" };
  await applyD1Migrations(conf.DB as never, join(import.meta.dir, "../migrations"));
  const call = async (path: string, init: { method?: string; form?: Record<string, string>; json?: unknown; cookie?: string; origin?: string } = {}) => {
    const headers = new Headers({ origin: init.origin ?? ORIGIN });
    if (init.cookie) headers.set("cookie", init.cookie);
    let body: BodyInit | undefined;
    if (init.form) body = new URLSearchParams(init.form);
    if (init.json) { body = JSON.stringify(init.json); headers.set("content-type", "application/json"); }
    const res = await handle(new Request(ORIGIN + path, { method: init.method ?? (body ? "POST" : "GET"), headers, body }), conf);
    const cookie = (res?.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return { res: res!, cookie, to: res?.headers.get("location") };
  };
  return { conf, call };
}

test("the whole pay-me journey: set up, add a payer, lease, revoke, restore", async () => {
  const { conf, call } = await boot();
  const lease = (license: string) => call("/lease", { json: { license, host: "https://buddy.example", version: "0.1.4" } });

  expect((await call("/health")).res.status).toBe(200);
  expect((await lease("nope")).res.status).toBe(402);
  // A body that isn't an object is no license, not a crash.
  for (const json of [[], "x", 7]) expect((await call("/lease", { json })).res.status).toBe(402);

  // Only the admin's email can make the one account, and only once.
  expect((await call("/do/setup", { form: { email: "eve@example.com", password: PASSWORD } })).to).toBe("/login?e=setup");
  const setup = await call("/do/setup", { form: { email: ADMIN, password: PASSWORD } });
  expect(setup.to).toBe("/admin");
  expect((await call("/do/setup", { form: { email: ADMIN, password: PASSWORD } })).to).toBe("/login?e=setup");

  // Signed out, the admin forms send you to the login page.
  expect((await call("/do/grant", { form: { who: "buddy" } })).to).toBe("/login");
  expect((await call("/do/grant", { form: { who: "buddy" }, cookie: setup.cookie, origin: "https://evil.example" })).res.status).toBe(403);

  expect((await call("/do/grant", { form: { who: "" }, cookie: setup.cookie })).to).toBe("/admin?e=who");
  expect((await call("/do/grant", { form: { who: "buddy", days: "30" }, cookie: setup.cookie })).to).toBe("/admin?made=1");
  const [row] = await listLicenses(conf);
  expect(row).toMatchObject({ who: "buddy", leases: 0 });

  const ok = await (await lease(row!.license)).res.json() as { ok: boolean; key: string };
  expect(ok).toMatchObject({ ok: true, key: "engine-key" });

  await call("/do/revoke", { form: { license: row!.license }, cookie: setup.cookie });
  expect((await lease(row!.license)).res.status).toBe(402);
  await call("/do/restore", { form: { license: row!.license }, cookie: setup.cookie });
  expect((await lease(row!.license)).res.status).toBe(200);

  const [after] = await listLicenses(conf);
  expect(after).toMatchObject({ leases: 2, last_host: "https://buddy.example", last_version: "0.1.4" });
  expect(await metrics(conf, [after!])).toMatchObject({ paid: 1, accounts: 1, ok24: 2, refused24: 5 });

  // Sign out, then back in; a wrong password and a stranger's email both fail.
  const out = await call("/do/logout", { form: {}, cookie: setup.cookie });
  expect(out.to).toBe("/login");
  expect((await call("/do/grant", { form: { who: "x" }, cookie: setup.cookie })).to).toBe("/login");
  expect((await call("/do/login", { form: { email: ADMIN, password: "wrong wrong wrong" } })).to).toBe("/login?e=bad");
  expect((await call("/do/login", { form: { email: ADMIN, password: PASSWORD } })).to).toBe("/admin");
});

test("a lapsed payment stops getting keys", async () => {
  const { conf, call } = await boot();
  const { grant } = await import("../src/licenses.ts");
  const license = await grant(conf, "short", 1, Date.now() - 2 * 86400_000);
  expect((await call("/lease", { json: { license } })).res.status).toBe(402);
});
