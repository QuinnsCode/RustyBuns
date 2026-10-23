import { expect, setDefaultTimeout, test } from "bun:test";
import { seedOrg, seedRows } from "../src/seed-data.ts";
import { local, person, post } from "./app-kit.ts";

const N = 100_000;
setDefaultTimeout(120_000); // seeding 100k rows into in-memory D1 outlasts the 5 s default on a loaded runner

test("seedRows(100000) yields 100,000 contacts with unique emails, the same every time", () => {
  const emails = new Set<string>();
  let contacts = 0, companies = 0, deals = 0, activities = 0;
  for (const b of seedRows(N, 7)) {
    contacts += b.contacts.length; companies += b.companies.length; deals += b.deals.length; activities += b.activities.length;
    for (const c of b.contacts) emails.add(c.email as string);
  }
  expect(contacts).toBe(N);
  expect(emails.size).toBe(N);
  expect(companies).toBeGreaterThan(N / 13);
  expect(deals).toBeGreaterThan(N / 4);
  expect(activities).toBeGreaterThan(N);
  const first = seedRows(5, 7).next().value!.contacts[0]!, again = seedRows(5, 7).next().value!.contacts[0]!;
  expect([first.first_name, first.last_name, first.email]).toEqual([again.first_name, again.last_name, again.email]);
});

test("seedOrg(100000) lands in in-memory D1 and the counts agree", async () => {
  const app = await local();
  const { cookie, org, user } = await person(app, "alice@qcrm.test");
  const t0 = performance.now();
  const counts = await seedOrg(app.env, org, user.id, N, 7);
  const ms = Math.round(performance.now() - t0);
  console.log(`seedOrg(${N}): ${ms} ms, ${JSON.stringify(counts)}`);
  expect(ms).toBeLessThan(60_000);
  for (const t of ["contacts", "companies", "deals", "activities"] as const) {
    const n = await app.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE org_id = ?`).bind(org).first<{ n: number }>();
    expect(n?.n).toBe(counts[t]);
  }
  expect(counts.contacts).toBe(N);
  // One change per batch, not one per row: a syncing client learns the org was seeded.
  const changes = await app.env.DB.prepare("SELECT COUNT(*) AS n FROM changes WHERE org_id = ? AND op = 'seed'").bind(org).first<{ n: number }>();
  expect(changes!.n).toBeLessThan(1500);
  expect(changes!.n).toBeGreaterThan(0);
  const pull = await (await app(cookie, `/api/orgs/${org}/sync?since=0&limit=1`)).json();
  expect(pull.changes[0].op).toBe("seed");

  // The route caps n and needs an owner.
  expect((await post(app, cookie, `/api/orgs/${org}/seed`, { n: N + 1 })).status).toBe(400);
  const small = await post(app, cookie, `/api/orgs/${org}/seed`, { n: 24, seed: 1 });
  expect(small.status).toBe(201);
  expect((await small.json()).contacts).toBe(24);
  const insights = await (await app(cookie, `/api/orgs/${org}/insights`)).json();
  expect(insights.counts.contacts).toBe(N + 24);
  expect(insights.deals_by_stage.length).toBeGreaterThan(0);
  expect(insights.activities_per_week).toHaveLength(12);
  expect(insights.top_companies_by_open_pipeline.length).toBe(10);
});
