import { expect, test } from "bun:test";
import { local, person, post } from "./app-kit.ts";

test("the org file leaves soft-deleted rows out unless ?deleted=1, and says which it is", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "dump@qcrm.test");
  const base = `/api/orgs/${org}/contacts`;
  const keep = await (await post(app, cookie, base, { first_name: "Keep", email: "keep@example.com" })).json();
  const gone = await (await post(app, cookie, base, { first_name: "Gone", email: "gone@example.com" })).json();
  await app(cookie, `${base}/${gone.id}`, { method: "DELETE" });

  const live = await (await app(cookie, `/api/orgs/${org}/export`)).json();
  expect(live.includes_deleted).toBe(false);
  expect(live.contacts.map((c: { id: string }) => c.id)).toEqual([keep.id]);

  const all = await (await app(cookie, `/api/orgs/${org}/export?deleted=1`)).json();
  expect(all.includes_deleted).toBe(true);
  expect(all.contacts.map((c: { id: string }) => c.id).sort()).toEqual([keep.id, gone.id].sort());
  expect(all.contacts.find((c: { id: string }) => c.id === gone.id).deleted_at).toBeNumber();
});

test("contacts: create, list, search, paginate, update, soft-delete", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const base = `/api/orgs/${org}/contacts`;
  const made = [];
  for (const [first, last] of [["Ada", "Berg"], ["Adam", "Costa"], ["Ben", "Dubois"]]) {
    const r = await post(app, cookie, base, { first_name: first, last_name: last, email: `${first}.${last}@example.com`, tags: ["lead"] });
    expect(r.status).toBe(201);
    made.push(await r.json());
  }
  expect((await post(app, cookie, base, { first_name: "Bad", email: "not-an-email" })).status).toBe(400);
  expect((await post(app, cookie, `/api/orgs/${org}/deals`, { name: "x", stage: "maybe" })).status).toBe(400);
  expect((await post(app, cookie, `/api/orgs/${org}/deals`, { name: "x", amount_cents: -1 })).status).toBe(400);

  const all = await (await app(cookie, base)).json();
  expect(all.items).toHaveLength(3);
  expect(all.items[0].tags).toEqual(["lead"]);
  expect(all.next).toBeNull();

  const ad = await (await app(cookie, `${base}?q=AD`)).json();
  expect(ad.items.map((c: { first_name: string }) => c.first_name).sort()).toEqual(["Ada", "Adam"]);
  expect((await (await app(cookie, `${base}?q=ada.berg%40`)).json()).items).toHaveLength(1);

  const page1 = await (await app(cookie, `${base}?limit=2`)).json();
  expect(page1.items).toHaveLength(2);
  expect(page1.next).toBeString();
  const page2 = await (await app(cookie, `${base}?limit=2&cursor=${page1.next}`)).json();
  expect(page2.items).toHaveLength(1);
  expect(page2.next).toBeNull();
  const seen = new Set([...page1.items, ...page2.items].map((c: { id: string }) => c.id));
  expect(seen.size).toBe(3);

  const upd = await post(app, cookie, `${base}/${made[0].id}`, { title: "CTO" }, "PUT");
  expect(upd.status).toBe(200);
  const row = await upd.json();
  expect(row.title).toBe("CTO");
  expect(row.first_name).toBe("Ada");
  expect(row.updated_at).toBeGreaterThanOrEqual(made[0].updated_at);

  expect((await app(cookie, `${base}/${made[1].id}`, { method: "DELETE" })).status).toBe(200);
  expect((await app(cookie, `${base}/${made[1].id}`)).status).toBe(404);
  expect((await (await app(cookie, base)).json()).items).toHaveLength(2);
  expect((await app(cookie, `${base}/${made[1].id}`, { method: "DELETE" })).status).toBe(404);
});

test("sync: the change log replays every write, and a stale op is a conflict", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const contacts = `/api/orgs/${org}/contacts`, sync = `/api/orgs/${org}/sync`;
  const a = await (await post(app, cookie, contacts, { first_name: "Ada", email: "ada@example.com" })).json();
  const b = await (await post(app, cookie, contacts, { first_name: "Ben" })).json();
  await app(cookie, `${contacts}/${b.id}`, { method: "DELETE" });

  const pull = await (await app(cookie, `${sync}?since=0`)).json();
  expect(pull.done).toBe(true);
  expect(pull.changes.map((c: { entity: string; id: string; op: string }) => [c.entity, c.id, c.op])).toEqual([["contacts", a.id, "upsert"], ["contacts", b.id, "upsert"], ["contacts", b.id, "delete"]]);
  expect(pull.changes[0].data.first_name).toBe("Ada");
  expect(pull.changes[2].data.deleted_at).toBeNumber();
  const seqAfterCreate = pull.changes[0].seq;
  expect(pull.next).toBe(pull.changes[2].seq);
  const again = await (await app(cookie, `${sync}?since=${pull.next}`)).json();
  expect(again.changes).toEqual([]);
  const paged = await (await app(cookie, `${sync}?since=0&limit=2`)).json();
  expect(paged.changes).toHaveLength(2);
  expect(paged.done).toBe(false);

  // The server edits Ada after the client last saw her.
  await post(app, cookie, `${contacts}/${a.id}`, { title: "CTO" }, "PUT");
  const server = await (await app(cookie, `${contacts}/${a.id}`)).json();
  // A client edit based on the older seq, itself older than the server's: reported, not applied.
  const stale = await (await post(app, cookie, sync, { ops: [{ entity: "contacts", id: a.id, op: "upsert", baseSeq: seqAfterCreate, data: { title: "Intern", updated_at: server.updated_at - 1000 } }] })).json();
  expect(stale.applied).toBe(0);
  expect(stale.conflicts).toHaveLength(1);
  expect(stale.conflicts[0].id).toBe(a.id);
  expect(stale.conflicts[0].server.title).toBe("CTO");
  expect((await (await app(cookie, `${contacts}/${a.id}`)).json()).title).toBe("CTO");
  // The same edit, newer than the server's: still reported, but it wins.
  const newer = await (await post(app, cookie, sync, { ops: [{ entity: "contacts", id: a.id, op: "upsert", baseSeq: seqAfterCreate, data: { title: "Intern", updated_at: server.updated_at + 1000 } }] })).json();
  expect(newer.applied).toBe(1);
  expect(newer.conflicts).toHaveLength(1);
  const now = await (await app(cookie, `${contacts}/${a.id}`)).json();
  expect(now.title).toBe("Intern");
  expect(now.updated_at).toBe(server.updated_at + 1000);

  // A row the client made offline, with its own id.
  const id = crypto.randomUUID();
  const fresh = await (await post(app, cookie, sync, { ops: [{ entity: "companies", id, op: "upsert", data: { name: "Cedar Labs" } }, { entity: "deals", id: crypto.randomUUID(), op: "upsert", data: { stage: "won" } }] })).json();
  expect(fresh.applied).toBe(1);
  expect(fresh.rejected).toHaveLength(1);
  expect((await app(cookie, `/api/orgs/${org}/companies/${id}`)).status).toBe(200);
});
