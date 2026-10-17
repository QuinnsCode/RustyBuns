import { expect, test } from "bun:test";
import { handleApi } from "../src/api.ts";
import { runDue } from "../src/scripts.ts";
import { local, person, post } from "./app-kit.ts";

test("a script lists contacts and writes an activity; the run row says ok", async () => {
  const app = await local();
  const { cookie, org, user } = await person(app, "alice@qcrm.test");
  const scripts = `/api/orgs/${org}/scripts`;
  const ada = await (await post(app, cookie, `/api/orgs/${org}/contacts`, { first_name: "Ada", email: "ada@example.com" })).json();
  const made = await post(app, cookie, scripts, { name: "note the first", body: `
    const page = await qcrm.list("contacts", { q: input.prefix, limit: 10 });
    log("found", page.items.length, "contacts");
    const note = await qcrm.create("activities", { type: "note", contact_id: page.items[0].id, body: "scripted: " + input.prefix });
    return { noted: note.id, names: page.items.map((c) => c.first_name) };` });
  expect(made.status).toBe(201);
  const script = await made.json();

  const ran = await post(app, cookie, `${scripts}/${script.id}/run`, { input: { prefix: "ad" } });
  expect(ran.status).toBe(201);
  const run = await ran.json();
  expect(run.status).toBe("ok");
  expect(run.calls).toBeGreaterThanOrEqual(2);
  expect(run.log).toBe("found 1 contacts");
  expect(run.result.names).toEqual(["Ada"]);
  const activity = await (await app(cookie, `/api/orgs/${org}/activities/${run.result.noted}`)).json();
  expect(activity.contact_id).toBe(ada.id);
  expect(activity.body).toBe("scripted: ad");
  expect(activity.actor_user_id).toBe(user.id);

  const runs = await (await app(cookie, `${scripts}/${script.id}/runs`)).json();
  expect(runs).toHaveLength(1);
  expect(runs[0].id).toBe(run.id);
  expect(runs[0].result.names).toEqual(["Ada"]);
  expect((await (await app(cookie, scripts)).json()).map((s: { id: string }) => s.id)).toEqual([script.id]);

  // An edit is a fresh Worker: the next run sees the new body.
  expect((await post(app, cookie, `${scripts}/${script.id}`, { body: "return input.x * 2;" }, "PUT")).status).toBe(200);
  expect((await (await post(app, cookie, `${scripts}/${script.id}/run`, { input: { x: 21 } })).json()).result).toBe(42);
  // The examples install and the summary one runs.
  const examples = await (await post(app, cookie, `${scripts}/examples`, {})).json();
  expect(examples).toHaveLength(3);
  const summary = await (await post(app, cookie, `${scripts}/${examples[2].id}/run`, {})).json();
  expect(summary.status).toBe("ok");
  expect(summary.result.summary).toContain("1 contacts");
});

test("no network, a cap on time, and a script can't reach past the CRM rows", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const scripts = `/api/orgs/${org}/scripts`;
  const make = async (body: string) => (await (await post(app, cookie, scripts, { name: "t", body })).json()).id as string;
  const runIt = async (id: string) => (await post(app, cookie, `${scripts}/${id}/run`, {})).json();

  // The local twin runs the script in-process, so "no network" is read as the fetch failing or
  // being absent; on the edge globalOutbound: null makes every fetch throw.
  const outbound = await runIt(await make(`globalThis.fetch = () => { throw new Error("no outbound"); }; await fetch("https://example.com"); return 1;`));
  expect(outbound.status).toBe("error");
  expect(outbound.log).toContain("error:");

  const thrown = await runIt(await make(`await qcrm.get("contacts", "nope");`));
  expect(thrown.status).toBe("error");
  expect(thrown.log).toContain("not found");

  const reach = await runIt(await make(`return await qcrm.list("webhooks");`));
  expect(reach.status).toBe("error");
  expect(reach.log).toContain("scripts reach");

  // A loop that yields (a synchronous one would hold the local twin's thread; the edge kills it).
  const forever = await runIt(await make(`for (;;) await new Promise((r) => setTimeout(r, 5));`));
  expect(forever.status).toBe("timeout");
  expect(forever.finished_at - forever.started_at).toBeGreaterThanOrEqual(9_900);
}, 40_000);

test("roles: seasonal reads but cannot write or run; employee runs; owner deletes; no loader is 503", async () => {
  const app = await local();
  const alice = await person(app, "alice@qcrm.test");
  const bob = await person(app, "bob@qcrm.test");
  const carol = await person(app, "carol@qcrm.test");
  const scripts = `/api/orgs/${alice.org}/scripts`;
  await post(app, alice.cookie, `/api/orgs/${alice.org}/members`, { email: "bob@qcrm.test" });
  await post(app, alice.cookie, `/api/orgs/${alice.org}/members`, { email: "carol@qcrm.test", role: "employee" });
  const s = await (await post(app, alice.cookie, scripts, { name: "one", body: "return 1;" })).json();
  expect((await post(app, bob.cookie, scripts, { name: "x", body: "return 2;" })).status).toBe(403);
  expect((await post(app, bob.cookie, `${scripts}/${s.id}/run`, {})).status).toBe(403);
  expect((await app(bob.cookie, `${scripts}/${s.id}`)).status).toBe(200);
  expect((await post(app, carol.cookie, `${scripts}/${s.id}/run`, {})).status).toBe(201);
  expect((await post(app, carol.cookie, scripts, { name: "x", body: "return 2;" })).status).toBe(403);
  expect((await app(carol.cookie, `${scripts}/${s.id}`, { method: "DELETE" })).status).toBe(403);
  expect((await app(alice.cookie, `${scripts}/${s.id}`, { method: "DELETE" })).status).toBe(200);
  expect((await app(alice.cookie, `${scripts}/${s.id}`)).status).toBe(404);

  const off = await local({ LOADER: undefined });
  const d = await person(off, "dave@qcrm.test");
  expect((await off(d.cookie, `/api/orgs/${d.org}/scripts`)).status).toBe(503);
});

test("a scheduled script runs on the cron as the person who set it, and not before it is due", async () => {
  const app = await local();
  const alice = await person(app, "alice@qcrm.test");
  const bob = await person(app, "bob@qcrm.test");
  const scripts = `/api/orgs/${alice.org}/scripts`;
  await post(app, alice.cookie, `/api/orgs/${alice.org}/members`, { email: "bob@qcrm.test", role: "employee" });
  const dispatch = (r: Request) => handleApi(r, app.env);

  expect((await post(app, bob.cookie, scripts, { name: "x", body: "return 1;", schedule: "daily" })).status).toBe(403);
  expect((await post(app, alice.cookie, scripts, { name: "x", body: "return 1;", schedule: "weekly" })).status).toBe(400);
  const made = await (await post(app, alice.cookie, scripts, { name: "nightly note", schedule: "daily", body: `
    const c = await qcrm.create("contacts", { first_name: "Nightly" });
    return c.id;` })).json();
  expect(made.schedule).toBe("daily");

  const t0 = Date.now();
  expect(await runDue(app.env, dispatch, t0)).toBe(1);
  expect(await runDue(app.env, dispatch, t0 + 3_600_000)).toBe(0);
  const runs = await (await app(alice.cookie, `${scripts}/${made.id}/runs`)).json();
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ status: "ok", trigger: "schedule", actor_user_id: alice.user.id });
  const made2 = await (await app(alice.cookie, `/api/orgs/${alice.org}/contacts/${runs[0].result}`)).json();
  expect(made2.first_name).toBe("Nightly");
  expect(await runDue(app.env, dispatch, t0 + 24 * 3_600_000)).toBe(1);

  // Clearing the schedule stops it; the person it runs as leaving the org skips it, on the record.
  await post(app, alice.cookie, `${scripts}/${made.id}`, { schedule: null }, "PUT");
  expect(await runDue(app.env, dispatch, t0 + 72 * 3_600_000)).toBe(0);
  await post(app, alice.cookie, `/api/orgs/${alice.org}/members/${bob.user.id}`, { role: "manager" }, "PUT");
  const bobs = await (await post(app, bob.cookie, scripts, { name: "bobs", body: "return 1;", schedule: "hourly" })).json();
  await app.env.DB.prepare("DELETE FROM memberships WHERE user_id = ? AND org_id = ?").bind(bob.user.id, alice.org).run();
  await runDue(app.env, dispatch, t0 + 96 * 3_600_000);
  const skipped = await (await app(alice.cookie, `${scripts}/${bobs.id}/runs`)).json();
  expect(skipped[0]).toMatchObject({ status: "skipped", trigger: "schedule" });
  expect(skipped[0].log).toContain("no longer in the org");
});

test("quota policies stack: a person's hourly cap by role, then the org's day", async () => {
  const app = await local();
  const alice = await person(app, "alice@qcrm.test");
  const bob = await person(app, "bob@qcrm.test");
  const scripts = `/api/orgs/${alice.org}/scripts`;
  await post(app, alice.cookie, `/api/orgs/${alice.org}/members`, { email: "bob@qcrm.test", role: "employee" });
  const s = await (await post(app, alice.cookie, scripts, { name: "t", body: "return 1;" })).json();
  const fill = (user: string, n: number, calls = 0, ago = 60_000) => app.env.DB.batch(Array.from({ length: n }, () =>
    app.env.DB.prepare("INSERT INTO script_runs (id, org_id, script_id, actor_user_id, started_at, finished_at, status, calls) VALUES (?, ?, ?, ?, ?, ?, 'ok', ?)")
      .bind(crypto.randomUUID(), alice.org, s.id, user, Date.now() - ago, Date.now() - ago, calls)));

  await fill(bob.user.id, 20);
  const refused = await post(app, bob.cookie, `${scripts}/${s.id}/run`, {});
  expect(refused.status).toBe(429);
  expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  expect((await refused.json()).policy).toBe("employee-hour");
  // Alice is an admin: her own hourly cap is 200, so Bob's runs don't touch it.
  expect((await post(app, alice.cookie, `${scripts}/${s.id}/run`, {})).status).toBe(201);

  // Runs older than the window free the person; the org's day is the next policy down.
  await app.env.DB.prepare("UPDATE script_runs SET started_at = started_at - 7200000").run();
  expect((await post(app, bob.cookie, `${scripts}/${s.id}/run`, {})).status).toBe(201);
  await fill(alice.user.id, 1000, 0, 7_200_000);
  const day = await post(app, alice.cookie, `${scripts}/${s.id}/run`, {});
  expect(day.status).toBe(429);
  expect((await day.json()).policy).toBe("org-runs-day");
});
