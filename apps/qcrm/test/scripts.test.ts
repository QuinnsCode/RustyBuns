import { expect, test } from "bun:test";
import { hourly } from "../src/demo.ts";
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

  // The local twin runs each script in a Bun Worker of its own with fetch stubbed out.
  const outbound = await runIt(await make(`await fetch("https://example.com"); return 1;`));
  expect(outbound.status).toBe("error");
  expect(outbound.log).toContain("network access is blocked");

  const thrown = await runIt(await make(`await qcrm.get("contacts", "nope");`));
  expect(thrown.status).toBe("error");
  expect(thrown.log).toContain("not found");

  const reach = await runIt(await make(`return await qcrm.list("webhooks");`));
  expect(reach.status).toBe("error");
  expect(reach.log).toContain("scripts reach");

  // A loop that never returns, even a synchronous one, is killed at the cap and the host stays up.
  for (const loop of [`for (;;) await new Promise((r) => setTimeout(r, 5));`, `for (;;) {}`]) {
    const forever = await runIt(await make(loop));
    expect(forever.status).toBe("timeout");
    expect(forever.finished_at - forever.started_at).toBeGreaterThanOrEqual(9_900);
  }
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

test("an org's runs a day: past the cap a run is 429; a script on the hour runs from the cron as its maker", async () => {
  const app = await local();
  const { cookie, org, user } = await person(app, "alice@qcrm.test");
  const scripts = `/api/orgs/${org}/scripts`;
  const s = await (await post(app, cookie, scripts, { name: "one", body: "return 1;" })).json();
  expect((await post(app, cookie, `${scripts}/limits`, { runs_per_day: 2 }, "PUT")).status).toBe(200);
  expect((await post(app, cookie, `${scripts}/${s.id}/run`, {})).status).toBe(201);
  expect((await post(app, cookie, `${scripts}/${s.id}/run`, {})).status).toBe(201);
  const over = await post(app, cookie, `${scripts}/${s.id}/run`, {});
  expect(over.status).toBe(429);
  expect((await over.json()).error).toContain("2 runs a day");
  expect(await (await app(cookie, `${scripts}/limits`)).json()).toEqual({ runs_per_day: 2, runs_last_day: 2 });

  // Hourly is the only schedule; the cron skips an org at its cap, and runs it once there's room.
  expect((await post(app, cookie, scripts, { name: "x", body: "return 1;", cron: "*/5 * * * *" })).status).toBe(400);
  const ada = await (await post(app, cookie, `/api/orgs/${org}/contacts`, { first_name: "Ada" })).json();
  const timed = await (await post(app, cookie, scripts, { name: "nightly note", cron: "@hourly", body: `
    const note = await qcrm.create("activities", { type: "note", contact_id: (await qcrm.list("contacts")).items[0].id, body: "on the hour" });
    return { scheduled: input.scheduled, note: note.id };` })).json();
  expect(timed.cron).toBe("0 * * * *");
  await hourly(app.env);
  expect(await (await app(cookie, `${scripts}/${timed.id}/runs`)).json()).toEqual([]);

  await post(app, cookie, `${scripts}/limits`, { runs_per_day: 10 }, "PUT");
  await hourly(app.env);
  const runs = await (await app(cookie, `${scripts}/${timed.id}/runs`)).json();
  expect(runs).toHaveLength(1);
  expect(runs[0].status).toBe("ok");
  expect(runs[0].actor_user_id).toBe(user.id);
  expect(runs[0].result.scheduled).toBe(true);
  const note = await (await app(cookie, `/api/orgs/${org}/activities/${runs[0].result.note}`)).json();
  expect(note.contact_id).toBe(ada.id);
  // The run's key is gone, and was never in the org's key list.
  expect(await (await app(cookie, `/api/orgs/${org}/keys`)).json()).toEqual([]);
});
