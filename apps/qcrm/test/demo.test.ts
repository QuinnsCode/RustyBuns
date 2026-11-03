import { expect, setDefaultTimeout, test } from "bun:test";
import { hourly } from "../src/demo.ts";
import { DEMO_CONTACTS } from "../src/demo-snapshot.ts";
import { local } from "./app-kit.ts";

setDefaultTimeout(30_000);

/** A bucket in memory, standing in for the DEMO R2 binding. */
function bucket() {
  const objects = new Map<string, ArrayBuffer>();
  let puts = 0;
  return {
    objects, puts: () => puts,
    async get(key: string) { const b = objects.get(key); return b ? { arrayBuffer: async () => b } : null; },
    async put(key: string, value: ArrayBuffer) { puts++; objects.set(key, value); },
  };
}

const rowsIn = async (app: Awaited<ReturnType<typeof local>>, org: string) =>
  (await app.env.DB.prepare("SELECT (SELECT COUNT(*) FROM contacts WHERE org_id = ?1) + (SELECT COUNT(*) FROM deals WHERE org_id = ?1) AS n").bind(org).first<{ n: number }>())?.n;

test("the demo opens on the shared snapshot, keeps a visitor's edit, and writes only what they touched", async () => {
  const DEMO = bucket();
  const app = await local({ DEMO });
  // The hourly cron builds the snapshot once and stores it.
  await hourly(app.env);
  expect(DEMO.objects.size).toBe(1);

  const res = await app("", "/api/demo", { method: "POST" });
  expect(res.status).toBe(201);
  const { org, user } = await res.json();
  expect(user.email).toMatch(/^demo-[a-z0-9]+@qcrm\.local$/);
  expect(org).toMatchObject({ name: "Demo Co", plan: "demo" });
  expect(org.seeded.contacts).toBe(DEMO_CONTACTS);
  expect(DEMO.puts()).toBe(1);
  expect(await rowsIn(app, org.id)).toBe(0);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const get = async (path: string) => (await app(cookie, `/api/orgs/${org.id}${path}`)).json();

  // The rows are there, paged, searched and counted like any org's.
  const first = await get("/contacts?limit=200");
  expect(first.total).toBe(DEMO_CONTACTS);
  expect(first.items).toHaveLength(200);
  expect(first.items[0].org_id).toBe(org.id);
  const second = await get(`/contacts?limit=200&cursor=${first.next}`);
  expect(second.items[0].id).not.toBe(first.items[0].id);
  expect(second.items.some((r: { id: string }) => first.items.some((f: { id: string }) => f.id === r.id))).toBe(false);
  const found = await get(`/contacts?q=${encodeURIComponent(first.items[5].email)}`);
  expect(found.items.map((r: { id: string }) => r.id)).toContain(first.items[5].id);
  expect((await get("/insights")).counts.contacts).toBe(DEMO_CONTACTS);

  // Edit one, delete another, move a deal: only those rows land in D1.
  const [a, b] = [second.items[3], second.items[4]];
  expect((await app(cookie, `/api/orgs/${org.id}/contacts/${a.id}`, { method: "PUT", body: JSON.stringify({ title: "Chief Demo Officer" }) })).status).toBe(200);
  expect((await app(cookie, `/api/orgs/${org.id}/contacts/${b.id}`, { method: "DELETE" })).status).toBe(200);
  const deal = (await get("/deals?stage=lead&limit=1")).items[0];
  expect((await app(cookie, `/api/orgs/${org.id}/deals/${deal.id}`, { method: "PUT", body: JSON.stringify({ stage: "proposal" }) })).status).toBe(200);
  expect(await rowsIn(app, org.id)).toBe(3);

  // Reload: the edit is on top, the deleted row is gone, the counts follow.
  const again = await get("/contacts?limit=1");
  expect(again.items[0]).toMatchObject({ id: a.id, title: "Chief Demo Officer" });
  expect(again.total).toBe(DEMO_CONTACTS - 1);
  expect((await app(cookie, `/api/orgs/${org.id}/contacts/${b.id}`)).status).toBe(404);
  expect((await get(`/deals/${deal.id}`)).stage).toBe("proposal");
  expect((await get("/insights")).counts.contacts).toBe(DEMO_CONTACTS - 1);

  // A second visitor sees the snapshot untouched.
  const other = await app("", "/api/demo", { method: "POST" });
  const o = (await other.json()).org.id, c2 = other.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  expect((await (await app(c2, `/api/orgs/${o}/contacts/${a.id}`)).json()).title).not.toBe("Chief Demo Officer");

  // The hourly sweep leaves a fresh demo alone, and removes one a day old with its account and its rows.
  await hourly(app.env);
  expect((await app(cookie, `/api/orgs/${org.id}`)).status).toBe(200);
  await app.env.DB.prepare("UPDATE orgs SET created_at = ? WHERE id = ?").bind(Date.now() - 25 * 3600_000, org.id).run();
  await hourly(app.env);
  expect((await app(cookie, `/api/orgs/${org.id}`)).status).toBe(401);
  expect(await rowsIn(app, org.id)).toBe(0);
});
