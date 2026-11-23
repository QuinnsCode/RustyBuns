import { afterAll, expect, test } from "bun:test";
import { parseJson } from "@rustybuns/util/http";
import { jwksOf, newKey, sign, TokenChecker } from "@rustybuns/util/token";
import { APP, Job, JobsReply, NOT_OWNER, Refusal, Run, SIGN_IN } from "../src/api.ts";
import { api } from "../src/server.ts";
import { Store } from "../src/store.ts";
import { tick } from "../src/ticker.ts";

// A URL a job calls: keeps every body it gets.
const got: unknown[] = [];
const hook = Bun.serve({ port: 0, fetch: async (req) => { got.push(parseJson(await req.text())); return new Response("ok"); } });
afterAll(() => hook.stop(true));

const at = (iso: string) => Date.parse(iso);

test("a day in the life: make jobs per app, the ticker fires them on the minute, pause, run by hand", async () => {
  const store = new Store();
  let now = at("2026-11-14T08:59:30Z");
  const call = api(store, { now: () => now });
  const ask = async (method: string, path: string, body?: unknown) => {
    const res = await call(new Request(`http://cron.test${path}`, { method, body: body === undefined ? null : JSON.stringify(body) }));
    return { status: res.status, body: parseJson(await res.text()) };
  };

  // Two apps, two lanes: a nightly backup that calls a URL, a weekly reminder that only shows in the feed.
  const backup = await ask("POST", "/api/jobs", {
    app: "qcrm", name: "Back up the CRM", why: "In case D1 eats itself", tags: ["Backup", " ops "],
    cadence: { kind: "daily", time: "09:00" }, tz: "UTC", action: { kind: "webhook", url: `${hook.url}backup`, method: "POST" },
  });
  expect(backup.status).toBe(201);
  const job = Job(backup.body);
  expect(job.tags).toEqual(["backup", "ops"]);
  expect(job.nextAt).toBe(at("2026-11-14T09:00:00Z"));
  expect((await ask("POST", "/api/jobs", {
    app: "eqosys", name: "Rotate the signing key", tags: ["security"], cadence: { kind: "weekly", time: "10:00", days: [1] }, tz: "UTC", action: { kind: "remind" },
  })).status).toBe(201);

  // A typo comes back saying which field.
  const typo = await ask("POST", "/api/jobs", { app: "qcrm", name: "x", tags: [], cadence: { kind: "cron", expr: "0 9 * *" }, tz: "UTC", action: { kind: "remind" } });
  expect([typo.status, Refusal(typo.body).error]).toEqual([400, expect.stringContaining("cadence.expr")]);

  // Not yet 09:00: nothing fires. A quarter second past: the backup fires once, its next run books for tomorrow.
  expect(await tick(store, now)).toEqual([]);
  now = at("2026-11-14T09:00:00.250Z");
  const [run] = await tick(store, now);
  expect(run).toMatchObject({ jobId: job.id, status: "ok", code: 200, scheduledAt: at("2026-11-14T09:00:00Z"), firedAt: now });
  expect(got).toEqual([expect.objectContaining({ job: job.id, app: "qcrm", scheduledAt: at("2026-11-14T09:00:00Z") })]);
  expect(await tick(store, now + 1000)).toEqual([]); // the same minute again fires nothing
  expect(store.job(job.id)?.nextAt).toBe(at("2026-11-15T09:00:00Z"));

  // The box was down for two days: the backup (two runs missed) and Monday's reminder each fire once when it's
  // back, saying how late, then go on from today.
  now = at("2026-11-17T09:30:00Z");
  const late = await tick(store, now);
  expect(late.map((r) => [r.status, r.firedAt - r.scheduledAt]).sort()).toEqual([
    ["ok", now - at("2026-11-15T09:00:00Z")],
    ["reminded", now - at("2026-11-16T10:00:00Z")],
  ]);
  expect(store.job(job.id)?.nextAt).toBe(at("2026-11-18T09:00:00Z"));

  // Paused, it has no next run and the ticker leaves it be; run by hand, it still fires and says so.
  const { id: _, createdAt: _c, updatedAt: _u, anchor: _a, nextAt: _n, ...input } = job;
  expect(Job((await ask("PUT", `/api/jobs/${job.id}`, { ...input, enabled: false })).body).nextAt).toBeNull();
  now = at("2026-11-18T09:00:01Z");
  expect(await tick(store, now)).toEqual([]);
  expect(Run((await ask("POST", `/api/jobs/${job.id}/run`)).body)).toMatchObject({ manual: true, status: "ok" });

  // The page's view: both apps, each job's last run, the feed newest first.
  const list = JobsReply((await ask("GET", "/api/jobs")).body);
  expect(list.jobs.map((r) => [r.job.app, r.last?.status]).sort()).toEqual([["eqosys", "reminded"], ["qcrm", "ok"]]);
  expect(list.runs.filter((r) => r.jobId === job.id).map((r) => r.manual)).toEqual([true, false, false]);

  expect((await ask("DELETE", `/api/jobs/${job.id}`)).status).toBe(200);
  expect((await ask("GET", `/api/jobs/${job.id}/runs`)).status).toBe(404);
});

test("the owner signed in with eqosys gets the jobs; nobody, a stranger or a token for another app gets a 401; scripts keep the bearer", async () => {
  // A stand-in eqosys: its JWKS, and tokens signed the way eqosys signs them.
  const signer = { EQOSYS_SIGNING_KEY: await newKey() };
  const eq = Bun.serve({ port: 0, fetch: async () => Response.json(await jwksOf(signer)) });
  const iss = eq.url.origin;
  const tokenFor = async (email: string, app = APP) => (await sign(signer, iss, { user: { id: `u_${email}`, email, name: email }, app, source: app, access: [] }))!;
  try {
    const call = api(new Store(), { token: "s3cret", owner: { email: "Owner@Example.com", checker: new TokenChecker(iss, APP) } });
    const ask = async (auth?: string) => {
      const res = await call(new Request("http://cron.test/api/jobs", { headers: auth ? { authorization: `Bearer ${auth}` } : {} }));
      const body = parseJson(await res.text());
      return res.ok ? [res.status, JobsReply(body).jobs.length] : [res.status, Refusal(body).error];
    };
    expect((await call(new Request("http://cron.test/api/health"))).status).toBe(200);
    expect(await ask(await tokenFor("owner@example.com"))).toEqual([200, 0]);
    expect(await ask("s3cret")).toEqual([200, 0]);
    expect(await ask()).toEqual([401, SIGN_IN]);
    expect(await ask(await tokenFor("someone@example.com"))).toEqual([401, NOT_OWNER]);
    expect(await ask(await tokenFor("owner@example.com", "qcrm"))).toEqual([401, SIGN_IN]);
    expect(await ask("nope")).toEqual([401, SIGN_IN]);
  } finally { eq.stop(true); }
});

test("tick a reminder off, let one slide: the counts the page sorts by", async () => {
  const store = new Store();
  let now = at("2026-11-23T08:59:30Z");
  const call = api(store, { now: () => now });
  const ask = async (method: string, path: string, body?: unknown) => {
    const res = await call(new Request(`http://cron.test${path}`, { method, body: body === undefined ? null : JSON.stringify(body) }));
    return { status: res.status, body: parseJson(await res.text()) };
  };
  const water = Job((await ask("POST", "/api/jobs", {
    app: "me", name: "Drink water", tags: ["body"], cadence: { kind: "every", minutes: 30 }, tz: "UTC", action: { kind: "remind" },
  })).body);
  const stats = async () => JobsReply((await ask("GET", "/api/jobs")).body).jobs.find((r) => r.job.id === water.id)!.stats;
  expect(await stats()).toEqual({ fired: 0, done: 0, ignored: 0, lastDoneAt: null, lastFiredAt: null });

  // It fires; ticked off five minutes later. A second tick keeps the first time.
  now = water.nextAt! + 250;
  const [first] = await tick(store, now);
  now += 5 * 60_000;
  const done = await ask("POST", `/api/runs/${first!.id}/done`);
  expect(Run(done.body).doneAt).toBe(now);
  await ask("POST", `/api/runs/${first!.id}/done`);
  expect(await stats()).toMatchObject({ fired: 1, done: 1, ignored: 0, lastDoneAt: now });

  // The next one nobody ticks: not ignored yet while it's the newest and under an hour old, ignored once the
  // next one fires.
  now = store.job(water.id)!.nextAt! + 250;
  await tick(store, now);
  expect(await stats()).toMatchObject({ fired: 2, done: 1, ignored: 0 });
  now = store.job(water.id)!.nextAt! + 250;
  await tick(store, now);
  expect(await stats()).toMatchObject({ fired: 3, done: 1, ignored: 1, lastFiredAt: now });

  // Snoozed from its toast: it says until when, and isn't ignored while it waits, even past the hour.
  const [latest] = store.runs(1, water.id);
  const snoozed = await ask("POST", `/api/runs/${latest!.id}/snooze`, { minutes: 90 });
  expect(Run(snoozed.body).snoozedUntil).toBe(now + 90 * 60_000);
  now += 70 * 60_000;
  expect(await stats()).toMatchObject({ ignored: 1 });
  expect((await ask("POST", `/api/runs/${latest!.id}/snooze`, { minutes: 0 })).status).toBe(400);

  expect((await ask("POST", "/api/runs/99999/done")).status).toBe(404);
});
