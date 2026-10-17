import { expect, test } from "bun:test";
import { handleApi } from "../src/api.ts";
import { ORIGIN } from "../src/local.ts";
import { orgId } from "../src/orgs.ts";
import { local, person, post, signup } from "./app-kit.ts";

const SUPER = "root@qcrm.test";

test("signing up makes an org whose id is a hash of the account, not the account", async () => {
  const app = await local({ SUPER_ADMIN_EMAIL: SUPER });
  const alice = await person(app, "alice@qcrm.test");
  expect(alice.org).toMatch(/^org_[A-Za-z0-9_-]{20}$/);
  expect(alice.org).toBe(await orgId(alice.user.id, app.env.BETTER_AUTH_SECRET!));
  expect(alice.org).not.toContain(alice.user.id);
  expect(await orgId(alice.user.id, "another-secret")).not.toBe(alice.org);
  const me = await (await app(alice.cookie, "/api/me")).json();
  expect(me.orgs[0].role).toBe("admin");
  expect(me.superAdmin).toBe(false);
  expect((await app("", "/api/me")).status).toBe(401);
});

test("roles: seasonal notes, managers delete, owners add webhooks, nobody sees another org", async () => {
  const app = await local({ SUPER_ADMIN_EMAIL: SUPER });
  const alice = await person(app, "alice@qcrm.test");
  const bob = await person(app, "bob@qcrm.test");
  const carol = await person(app, "carol@qcrm.test");
  const dave = await person(app, "dave@qcrm.test");
  const org = alice.org;

  // Added without a role: seasonal.
  const added = await post(app, alice.cookie, `/api/orgs/${org}/members`, { email: "bob@qcrm.test" });
  expect(added.status).toBe(201);
  expect((await added.json()).role).toBe("seasonal");
  expect((await post(app, alice.cookie, `/api/orgs/${org}/members`, { email: "carol@qcrm.test", role: "employee" })).status).toBe(201);

  const made = await post(app, alice.cookie, `/api/orgs/${org}/contacts`, { first_name: "Ada", last_name: "Berg", email: "ada@example.com" });
  expect(made.status).toBe(201);
  const contact = await made.json();

  expect((await post(app, bob.cookie, `/api/orgs/${org}/contacts`, { first_name: "No" })).status).toBe(403);
  const note = await post(app, bob.cookie, `/api/orgs/${org}/activities`, { type: "note", contact_id: contact.id, body: "called, left a message" });
  expect(note.status).toBe(201);
  expect((await note.json()).actor_user_id).toBe(bob.user.id);
  expect((await app(bob.cookie, `/api/orgs/${org}/contacts/${contact.id}`, { method: "DELETE" })).status).toBe(403);

  // An admin may make bob a manager; a manager may delete.
  expect((await post(app, alice.cookie, `/api/orgs/${org}/members/${bob.user.id}`, { role: "manager" }, "PUT")).status).toBe(200);
  expect((await app(bob.cookie, `/api/orgs/${org}/contacts/${contact.id}`, { method: "DELETE" })).status).toBe(200);
  expect((await app(bob.cookie, `/api/orgs/${org}/contacts/${contact.id}`)).status).toBe(404);
  // A manager may not hand out manager, nor touch webhooks.
  expect((await post(app, bob.cookie, `/api/orgs/${org}/members/${carol.user.id}`, { role: "manager" }, "PUT")).status).toBe(403);
  expect((await post(app, bob.cookie, `/api/orgs/${org}/webhooks`, { url: "https://example.com/hook" })).status).toBe(403);

  expect((await post(app, carol.cookie, `/api/orgs/${org}/webhooks`, { url: "https://example.com/hook" })).status).toBe(403);
  expect((await post(app, alice.cookie, `/api/orgs/${org}/webhooks`, { url: "https://example.com/hook" })).status).toBe(201);

  // Dave is in no org of Alice's: everything there is 404, the same as a made-up id.
  expect((await app(dave.cookie, `/api/orgs/${org}/contacts`)).status).toBe(404);
  expect((await app(dave.cookie, `/api/orgs/${org}/contacts/${contact.id}`)).status).toBe(404);
  expect((await app(dave.cookie, `/api/orgs/org_doesnotexist000000/contacts`)).status).toBe(404);

  // The super admin sees every org without being a member of any.
  const root = await person(app, SUPER);
  const all = await (await app(root.cookie, "/api/admin/orgs")).json();
  expect(all.map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining([alice.org, bob.org, carol.org, dave.org]));
  expect((await app(root.cookie, `/api/orgs/${org}/contacts`)).status).toBe(200);
  const members = await (await app(alice.cookie, `/api/orgs/${org}/members`)).json();
  expect(members.map((m: { user_id: string }) => m.user_id)).not.toContain(root.user.id);
  expect((await app(dave.cookie, "/api/admin/orgs")).status).toBe(403);
});

test("accounts off answers 503; cross-site cookie writes are refused", async () => {
  const off = await local({ BETTER_AUTH_SECRET: undefined });
  expect((await off("", "/api/me")).status).toBe(503);
  expect((await off("", "/api/auth/sign-up/email", { method: "POST", body: "{}" })).status).toBe(503);

  const app = await local();
  const cookie = await signup(app, "eve@qcrm.test");
  // The harness stamps our own Origin on every call; a foreign one has to go straight to the API.
  const foreign = await handleApi(new Request(`${ORIGIN}/api/orgs`, { method: "POST", body: JSON.stringify({ name: "x" }), headers: { cookie, origin: "https://evil.example", "content-type": "application/json" } }), app.env);
  expect(foreign.status).toBe(403);
  const noOrigin = await handleApi(new Request(`${ORIGIN}/api/orgs`, { method: "POST", body: JSON.stringify({ name: "x" }), headers: { cookie, "sec-fetch-site": "cross-site", "content-type": "application/json" } }), app.env);
  expect(noOrigin.status).toBe(403);
});

test("the sign-in form learns which social providers are on, signed out", async () => {
  const off = await local();
  expect(await (await off("", "/api/providers")).json()).toEqual(["email"]);
  const on = await local({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", GOOGLE_CLIENT_ID: "only-half" });
  expect(await (await on("", "/api/providers")).json()).toEqual(["email", "github"]);
});
