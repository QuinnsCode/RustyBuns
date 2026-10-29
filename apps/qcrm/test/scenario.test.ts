import { expect, test } from "bun:test";
import { hourly } from "../src/demo.ts";
import { tools } from "../src/mcp-tools.ts";
import { openapi } from "../src/openapi.ts";
import { local, post } from "./app-kit.ts";

const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

test("a scenario lands a signed-in owner on a populated workspace, and the owner can walk the situations it stands for", async () => {
  const app = await local();
  expect((await post(app, "", "/api/scenario", { name: "nope" })).status).toBe(400);
  const res = await post(app, "", "/api/scenario", { name: "webhooks" });
  expect(res.status).toBe(201);
  const { org, view } = await res.json();
  expect(view).toBe("settings");
  const cookie = cookieOf(res);
  const base = `/api/orgs/${org.id}`;

  // Soft-deleted rows: the download leaves them out and says so; ?deleted=1 brings them, with a flag.
  const plain = await (await app(cookie, `${base}/export`)).json();
  const withDeleted = await (await app(cookie, `${base}/export?deleted=1`)).json();
  expect(plain.includes_deleted).toBe(false);
  expect(plain.contacts.every((c: { deleted_at: number | null }) => c.deleted_at === null)).toBe(true);
  expect(withDeleted.includes_deleted).toBe(true);
  expect(withDeleted.contacts.length - plain.contacts.length).toBe(5);

  // Members, scripts, and deliveries of every status.
  expect((await (await app(cookie, `${base}/members`)).json()).map((m: { role: string }) => m.role).sort()).toEqual(["admin", "employee", "manager", "seasonal"]);
  expect(await (await app(cookie, `${base}/scripts`)).json()).toHaveLength(3);
  const [hook] = (await (await app(cookie, `${base}/webhooks`)).json()).webhooks;
  const deliveries = await (await app(cookie, `${base}/webhooks/${hook.id}/deliveries`)).json();
  expect(deliveries.map((d: { status: string }) => d.status).sort()).toEqual(["dead", "ok", "pending"]);

  // Replay: a dead delivery goes back for a fresh first try; one still waiting is refused.
  const dead = deliveries.find((d: { status: string }) => d.status === "dead");
  const waiting = deliveries.find((d: { status: string }) => d.status === "pending");
  expect((await post(app, cookie, `${base}/webhooks/${hook.id}/deliveries/${waiting.id}/replay`, {})).status).toBe(409);
  expect((await post(app, cookie, `${base}/webhooks/${hook.id}/deliveries/nope/replay`, {})).status).toBe(404);
  expect((await post(app, cookie, `${base}/webhooks/${hook.id}/deliveries/${dead.id}/replay`, {})).status).toBe(200);

  // The sweep takes the scenario's members with it.
  await app.env.DB.prepare("UPDATE orgs SET created_at = ? WHERE id = ?").bind(Date.now() - 25 * 3600_000, org.id).run();
  await hourly(app.env);
  expect((await app.env.DB.prepare(`SELECT COUNT(*) AS n FROM "user" WHERE email LIKE 'scenario-%'`).first<{ n: number }>())?.n).toBe(0);
});

test("the contact scenario names a live contact the row link can open", async () => {
  const app = await local();
  const res = await post(app, "", "/api/scenario", { name: "contact" });
  const { org, view, open } = await res.json();
  expect(view).toBe("contacts");
  expect(open.entity).toBe("contacts");
  const row = await app(cookieOf(res), `/api/orgs/${org.id}/contacts/${open.id}`);
  expect(row.status).toBe(200);
  expect((await row.json()).deleted_at ?? null).toBeNull();
});

test("the empty scenario has nothing in it, and a deployment answers 404", async () => {
  const app = await local();
  const res = await post(app, "", "/api/scenario", { name: "empty" });
  const { org } = await res.json();
  expect((await (await app(cookieOf(res), `/api/orgs/${org.id}/insights`)).json()).counts.contacts).toBe(0);
  const live = await local({ BETTER_AUTH_URL: "https://qcrm.example" });
  expect((await post(live, "", "/api/scenario", { name: "empty" })).status).toBe(404);
});

test("routes that refuse API keys say so in the spec and are not MCP tools", () => {
  const spec = openapi("") as any;
  expect(spec.paths["/me"].delete["x-qcrm-cookie-only"]).toBe(true);
  expect(spec.paths["/me"].delete.security).toEqual([{ cookie: [] }]);
  const names = tools().map((t) => t.name);
  for (const n of ["delete_me", "create_org", "list_keys", "create_key", "revoke_key"]) expect(names).not.toContain(n);
  expect(names).toContain("replay_delivery");
});
