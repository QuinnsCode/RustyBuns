import { expect, test } from "bun:test";
import { hourly } from "../src/demo.ts";
import { local } from "./app-kit.ts";

test("POST /api/demo signs a throwaway account in, owning Demo Co with 2,000 contacts", async () => {
  const app = await local();
  const res = await app("", "/api/demo", { method: "POST" });
  expect(res.status).toBe(201);
  const { org, user } = await res.json();
  expect(user.email).toMatch(/^demo-[a-z0-9]+@qcrm\.local$/);
  expect(org.name).toBe("Demo Co");
  expect(org.plan).toBe("demo");
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  expect(cookie).toContain("better-auth.session_token=");

  const me = await (await app(cookie, "/api/me")).json();
  expect(me.user.id).toBe(user.id);
  expect(me.orgs.map((o: { id: string }) => o.id)).toContain(org.id);
  const insights = await (await app(cookie, `/api/orgs/${org.id}/insights`)).json();
  expect(insights.counts.contacts).toBe(2000);
  let total = 0, cursor: string | null = null;
  do {
    const page: { items: unknown[]; next: string | null } = await (await app(cookie, `/api/orgs/${org.id}/contacts?limit=200${cursor ? `&cursor=${cursor}` : ""}`)).json();
    total += page.items.length; cursor = page.next;
  } while (cursor);
  expect(total).toBe(2000);

  // The hourly sweep leaves a fresh demo alone, and removes one a day old with its account.
  await hourly(app.env);
  expect((await app(cookie, `/api/orgs/${org.id}`)).status).toBe(200);
  await app.env.DB.prepare("UPDATE orgs SET created_at = ? WHERE id = ?").bind(Date.now() - 25 * 3600_000, org.id).run();
  await hourly(app.env);
  expect((await app(cookie, `/api/orgs/${org.id}`)).status).toBe(401);
  expect((await app.env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE org_id = ?").bind(org.id).first<{ n: number }>())?.n).toBe(0);
});
