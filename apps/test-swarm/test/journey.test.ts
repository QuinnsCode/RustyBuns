// One SHA through the swarm (#4758): an agent queues it, two runners share it, one goes quiet and its job goes back,
// and once every suite is green the stub GitHub gets the `typecheck` and `apps` statuses, once each.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject } from "@rustybuns/shell-bun";
import { readJson } from "@rustybuns/util/http";
import { check, obj, str } from "@rustybuns/util/guard";
import worker, { Queue, type Env } from "../src/worker.ts";
import { JobsReply, LeaseReply, Ok, QueueReply } from "../src/api.ts";

setDefaultTimeout(20_000);
const TOKEN = "swarm-test-token";
const SHA = "a".repeat(40);

// The stub GitHub: every status posted, with the token it came with.
const posted: { sha: string; state: string; context: string; auth: string | null }[] = [];
const github = Bun.serve({
  port: 0,
  async fetch(req) {
    const m = new URL(req.url).pathname.match(/^\/repos\/QuinnsCode\/RustyBuns\/statuses\/([0-9a-f]{40})$/);
    if (!m || req.method !== "POST") return new Response("no", { status: 404 });
    const b = check(obj({ state: str(20), context: str(40) }), await req.json())!;
    posted.push({ sha: m[1]!, state: b.state, context: b.context, auth: req.headers.get("authorization") });
    return Response.json({ id: posted.length }, { status: 201 });
  },
});
afterAll(() => github.stop(true));

const base = { SWARM_TOKEN: TOKEN, GITHUB_STATUS_TOKEN: "gh-status", GITHUB_REPO: "QuinnsCode/RustyBuns", GITHUB_API: github.url.origin };
const env: Env = { ...base, QUEUE: durableObject(Queue, base) };

const call = (path: string, body?: unknown, token = TOKEN) => worker.fetch(new Request(`https://swarm.test${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { authorization: `Bearer ${token}` },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env);
const lease = async (runner: string, seconds?: number) => (await readJson(await call("/lease", { runner, seconds }), LeaseReply))!.job;
const report = (lease: string, ok: boolean, log = "") => call("/report", { lease, ok, log });

test("two runners share a SHA, a quiet one's job goes back, and GitHub hears green once", async () => {
  // Only our own agents get in, and a body that isn't a job is turned away.
  expect((await call("/enqueue", { sha: SHA, branch: "office/x", suites: ["typecheck"] }, "a fork")).status).toBe(401);
  expect((await call("/enqueue", { sha: "main", branch: "office/x", suites: ["typecheck"] })).status).toBe(400);
  expect((await call("/enqueue", { sha: SHA, branch: "office/x", suites: ["typecheck", "eqosys", "codesplitter:1/3"] })).status).toBe(200);

  // Bob takes one on a short lease and goes quiet; Alice takes the next two.
  const bob = (await lease("bob", 1))!;
  expect(bob.suite).toBe("typecheck");
  const a1 = (await lease("alice"))!, a2 = (await lease("alice"))!;
  expect([a1.suite, a2.suite]).toEqual(["eqosys", "codesplitter:1/3"]);
  expect(await lease("alice")).toBeNull();

  // A suite failing pulls the apps status red at once; queued again, it runs again and the red is cleared.
  expect((await report(a1.lease, false, "1 fail")).status).toBe(200);
  expect(posted).toEqual([{ sha: SHA, state: "failure", context: "apps", auth: "Bearer gh-status" }]);
  posted.length = 0;
  await call("/enqueue", { sha: SHA, branch: "office/x", suites: ["eqosys"] });
  const a3 = (await lease("alice"))!;
  expect(a3.suite).toBe("eqosys");
  await report(a3.lease, true);
  await report(a2.lease, true);
  expect(posted).toEqual([]);

  // Bob's lease runs out: his job goes back, Alice takes it, and Bob's late report doesn't count.
  await Bun.sleep(1100);
  const again = (await lease("alice"))!;
  expect(again.suite).toBe("typecheck");
  expect(again.lease).not.toBe(bob.lease);
  expect((await readJson(await report(bob.lease, true), Ok))).toBeNull();   // 409
  expect((await call("/extend", { lease: bob.lease })).status).toBe(409);
  expect((await call("/extend", { lease: again.lease })).status).toBe(200);
  await report(again.lease, true, "ok");

  // Every suite green: both statuses posted, once.
  expect(posted.map((p) => `${p.context}:${p.state}`).sort()).toEqual(["apps:success", "typecheck:success"]);
  const jobs = (await readJson(await call(`/jobs?sha=${SHA}`), JobsReply))!;
  expect(jobs.posted).toBe("success");
  expect(jobs.jobs.map((j) => [j.suite, j.state, j.runner, j.tries])).toEqual([
    ["typecheck", "passed", "alice", 2], ["eqosys", "passed", "alice", 2], ["codesplitter:1/3", "passed", "alice", 1],
  ]);
  expect(posted).toHaveLength(2);
});

test("the queue lists what waits and who holds what, in the order runners take them, and only for us", async () => {
  const qenv: Env = { SWARM_TOKEN: TOKEN, QUEUE: durableObject(Queue, {}) };
  const ask = (path: string, body?: unknown, token = TOKEN) => worker.fetch(new Request(`https://swarm.test${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body),
  }), qenv);
  const B = "b".repeat(40), C = "c".repeat(40);
  await ask("/enqueue", { sha: B, branch: "office/b", suites: ["typecheck", "eqosys"] });
  await ask("/enqueue", { sha: C, branch: "office/c", suites: ["qcrm"] });
  const held = (await readJson(await ask("/lease", { runner: "bob/1", seconds: 60 }), LeaseReply))!.job!;
  const done = (await readJson(await ask("/lease", { runner: "bob/2" }), LeaseReply))!.job!;
  await ask("/report", { lease: done.lease, ok: true, log: "" });

  expect((await ask("/queue", undefined, "a fork")).status).toBe(401);
  const q = (await readJson(await ask("/queue"), QueueReply))!;
  expect(q.jobs.map((j) => [j.sha.slice(0, 1), j.branch, j.suite, j.state, j.runner])).toEqual([
    ["b", "office/b", "typecheck", "leased", "bob/1"], ["c", "office/c", "qcrm", "queued", ""],
  ]);
  expect(q.jobs[0]!.until).toBe(held.until);
});
