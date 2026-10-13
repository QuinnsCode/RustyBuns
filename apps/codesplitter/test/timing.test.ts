import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

// Every API call paid the session lookup's D1 reads before its route ran (#1313).
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const origin = "http://codesplitter.local";

describe("API timing (#1313)", () => {
  test("answers carry Server-Timing; a known cookie skips D1 until it signs out", async () => {
    const call = await boot({ GH_CLI: "off", BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: origin });
    opened.push(call);
    const res = await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "ana@example.com", password: "correct horse battery", name: "ana" }) });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect((await call(null, "/api/handle", { method: "POST", headers: { cookie }, body: JSON.stringify({ name: "ana-digger" }) })).status).toBe(201);

    const me = await call(null, "/api/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(me.headers.get("server-timing")).toMatch(/^identify;dur=[\d.]+, limit;dur=[\d.]+, app;dur=[\d.]+, total;dur=[\d.]+$/);

    // Seen a moment ago: the handle comes from the isolate, not the session table.
    const db = call.env.DB, rows = await db.prepare(`SELECT * FROM session`).all();
    await db.prepare(`DELETE FROM session`).run();
    expect(((await (await call(null, "/api/me", { headers: { cookie } })).json()) as any).name).toBe("ana-digger");
    for (const r of rows.results as Record<string, unknown>[]) {
      const k = Object.keys(r);
      await db.prepare(`INSERT INTO session (${k.map((c) => `"${c}"`).join(", ")}) VALUES (${k.map(() => "?").join(", ")})`).bind(...Object.values(r)).run();
    }

    // Signing out forgets it at once.
    expect((await call(null, "/api/auth/sign-out", { method: "POST", headers: { cookie, origin } })).status).toBe(200);
    expect((await call(null, "/api/me", { headers: { cookie } })).status).toBe(401);
  });
});
