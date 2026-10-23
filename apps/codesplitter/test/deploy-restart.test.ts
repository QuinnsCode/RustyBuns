import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { local } from "./app-kit.ts";
import { Interrupted, runAgent, type Exec } from "../src/agent-run.ts";
import { runQueuedAgents } from "../src/agent-routes.ts";
import { GRANT_MS } from "../src/file-do.ts";

// A deploy keeps a Durable Object's storage and restarts the object (REFERENCE.md, "What a deploy does to live
// sessions"). `evict` is the local twin of that: the live instance goes, storage and sockets stay.

async function app() {
  const call = await local({ GH_CLI: "off", DRAIN_SECRET: "s3cret" });
  const post = (user: string | null, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  await post("ryan", "/api/login", { name: "ryan" });
  await post("ryan", "/api/repos", { name: "lab", visibility: "public" });
  for (const a of ["agent-x", "agent-y"]) await post("ryan", "/api/repos/ryan/lab/collaborators", { name: a });
  await post("ryan", "/api/repos/ryan/lab/files", { path: "a.js", content: "one\ntwo\nthree\nfour" });
  const restart = () => call.env.FILES.evict(call.env.FILES.idFromName("ryan/lab/a.js"));
  const doc = async () => (await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.js")).json()) as { lines: { id: string; text: string }[] };
  const claims = async () => (await (await call("ryan", "/api/repos/ryan/lab/do/claims?path=a.js")).json()) as any[];
  const claim = (user: string, body: unknown) => post(user, "/api/repos/ryan/lab/do/claims?path=a.js", body);
  return { call, post, restart, doc, claims, claim };
}

test("an update under a claim, a waiter and an agent run loses none of them", async () => {
  const { call, post, restart, doc, claims, claim } = await app();
  const [l1, l2, l3] = (await doc()).lines.map((l) => l.id);

  // A person holds line 1, and an agent gets in line behind them.
  expect((await claim("ryan", { id: "hold", lines: [l1] })).status).toBe(201);
  const waiting = await claim("agent-y", { id: "w1", lines: [l1], wait: true, timeout: 0 });
  expect(waiting.status).toBe(202);

  // An agent run on line 2: the object restarts while its CLI thinks, and its reads meet a dead object first.
  let down = 0;
  const plain = (u: string | null, url: string, init?: RequestInit) => down > 0 && url.includes("/do/file") ? (down--, Promise.reject(new Error("Durable Object reset"))) : call(u, url, init);
  const exec: Exec = async (_c, cwd) => { restart(); down = 2; writeFileSync(join(cwd, "a.js"), "one\nTWO\nthree\nfour\n"); return { code: 0, out: "done" }; };
  const r = await runAgent(plain, { user: "agent-x", owner: "ryan", repo: "lab", path: "a.js", harness: "claude", task: "shout", lines: [l2!], claim: "run-1", exec, pause: async () => {} });
  expect(r.applied).toBe(1);
  expect((await doc()).lines.map((l) => l.text)).toEqual(["one", "TWO", "three", "four"]);
  // Its claim was let go as it ended, not left to idle out its lease.
  expect((await claims()).map((c) => c.id)).toEqual(["hold"]);

  // The person lets go after another restart: the waiter, kept in storage, is granted.
  restart();
  await post("ryan", "/api/repos/ryan/lab/do/release?path=a.js", { id: "hold" });
  const granted = (await claims()).find((c) => c.id === "w1");
  expect(granted).toMatchObject({ who: "agent-y", grant: true });
  // A restart in the grant window gives it the window again, so the waiter still has its turn.
  await Bun.sleep(300);
  restart();
  const again = (await claims()).find((c) => c.id === "w1");
  expect(again.until).toBeGreaterThan(granted.until + 200);
  expect(again.until - Date.now()).toBeGreaterThan(GRANT_MS - 1000);
  expect((await claim("agent-y", { id: "w1" })).status).toBe(200);

  // Drain: the busy file hears about it, takes no new claim, and still takes an edit and a renewal.
  const drain = (body: unknown, secret = "s3cret") => call(null, "/api/admin/drain", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
  expect((await drain({ in: 0 }, "wrong")).status).toBe(404);
  const told = await (await drain({ in: 0 })).json() as any;
  expect(told).toMatchObject({ drained: 1 });
  const refused = await claim("ryan", { id: "late", lines: [l3] });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ draining: true, updating: true, retryAfter: 5 });
  expect((await claim("agent-y", { id: "w1" })).status).toBe(200);
  const edit = await post("ryan", "/api/repos/ryan/lab/do/ops?path=a.js", { ops: [{ kind: "insert", after: null, text: "zero" }] });
  expect(edit.status).toBe(200);
  await drain({ cancel: true });
  expect((await claim("ryan", { id: "late", lines: [l3] })).status).toBe(201);

  // Version safety: a writer started on another protocol is told to retry, not given an edit.
  const stale = await post("ryan", "/api/repos/ryan/lab/do/ops?path=a.js", { proto: 999, ops: [{ kind: "insert", after: null, text: "never" }] });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ updating: true });
  expect((await doc()).lines.map((l) => l.text)).not.toContain("never");

  // A call cut by the restart itself is a retryable 503, not a 500.
  const real = call.env.FILES.get.bind(call.env.FILES);
  call.env.FILES.get = () => ({ fetch: () => Promise.reject(new Error("Durable Object reset because its code was updated")) });
  const cut = await call("ryan", "/api/repos/ryan/lab/do/claims?path=a.js");
  call.env.FILES.get = real;
  expect(cut.status).toBe(503);
  expect(await cut.json()).toMatchObject({ updating: true, retryAfter: 5 });
});

test("a draining file tells its sockets, deploy-soon then draining", async () => {
  const { call, doc } = await app();
  await doc();
  const ws = ((await call("ryan", "/api/repos/ryan/lab/do/ws?path=a.js", { headers: { upgrade: "websocket" } })) as any).webSocket, got: any[] = [];
  ws.toBrowser = (d: string) => got.push(JSON.parse(d));
  const at = Date.now() + 150;
  const stub = call.env.FILES.get(call.env.FILES.idFromName("ryan/lab/a.js"));
  const ask = (body: unknown) => stub.fetch(new Request("https://file/drain", { method: "POST", body: JSON.stringify(body) }));
  await ask({ in: 0.15 });
  await Bun.sleep(400);
  const told = got.filter((m) => m.t);
  expect(told.map((m) => m.t)).toEqual(["deploy-soon", "draining"]);
  expect(told[0].at).toBeGreaterThanOrEqual(at - 100);
  await ask({ cancel: true });
  expect(got.at(-1)).toEqual({ t: "drain-over" });
});

test("a run an update cut off starts again, twice at most, with its claim let go", async () => {
  const { call, claim, doc } = await app();
  call.env.AGENT_SANDBOX = {};
  const sent: any[] = [];
  call.env.JOBS = { send: async (body: any, opts: any) => { sent.push([body, opts]); } };
  const l1 = (await doc()).lines[0]!.id;
  await claim("agent-x", { id: "run-1", lines: [l1] });
  const sql = "INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started, picked, result) VALUES ('ryan', 'lab', 'a.js', 'claude', 'x', 'agent-x', 'running', ?, 1, ?) RETURNING id";
  const id = (await call.env.DB.prepare(sql).bind(Date.now() - 200_000, JSON.stringify({ lines: [l1], beat: Date.now() - 200_000 })).first() as { id: number }).id;
  const run = async () => (await (await call("ryan", "/api/repos/ryan/lab/agents?path=a.js")).json() as any[]).find((r) => r.id === id);

  // Its consumer stopped saying it was alive: the listing releases its claim and queues it again.
  expect(await run()).toMatchObject({ status: "running", restarts: 1 });
  expect((await run()).log.at(-1)).toBe("interrupted by update, retrying");
  expect(sent).toEqual([[{ agent: id, origin: "http://codesplitter.local" }, { delaySeconds: 10 }]]);
  expect(await call("ryan", "/api/repos/ryan/lab/do/claims?path=a.js").then((r) => r.json())).toEqual([]);

  // The queue's own redelivery of a run picked up before says the same, and the third time it stays failed.
  await call.env.DB.prepare("UPDATE agent_runs SET picked = 1, result = ? WHERE id = ?").bind(JSON.stringify({ restarts: 1, beat: 1 }), id).run();
  await runQueuedAgents([{ body: { agent: id, origin: "http://x" }, ack: () => {} }], call.env, async () => new Response("{}"));
  expect(sent.length).toBe(2);
  await call.env.DB.prepare("UPDATE agent_runs SET picked = 1, result = ? WHERE id = ?").bind(JSON.stringify({ restarts: 2, beat: 1 }), id).run();
  await runQueuedAgents([{ body: { agent: id, origin: "http://x" }, ack: () => {} }], call.env, async () => new Response("{}"));
  expect(sent.length).toBe(2);
  expect(await run()).toMatchObject({ status: "failed", error: "interrupted by update 3 times: start it again" });
});

test("a run still saying it is alive is left alone, and an edit cut by a restart ends the round as interrupted", async () => {
  const { call, doc } = await app();
  call.env.AGENT_SANDBOX = {};
  const sent: any[] = [];
  call.env.JOBS = { send: async (body: any) => { sent.push(body); } };
  const sql = "INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started, picked, result) VALUES ('ryan', 'lab', 'a.js', 'claude', 'x', 'agent-x', 'running', ?, 1, ?) RETURNING id";
  const id = (await call.env.DB.prepare(sql).bind(Date.now() - 200_000, JSON.stringify({ beat: Date.now() - 5000 })).first() as { id: number }).id;
  await runQueuedAgents([{ body: { agent: id, origin: "http://x" }, ack: () => {} }], call.env, async () => new Response("{}"));
  const runs = await (await call("ryan", "/api/repos/ryan/lab/agents?path=a.js")).json() as any[];
  expect(runs.find((r) => r.id === id)).toMatchObject({ status: "running" });
  expect(sent).toEqual([]);

  // An edit is not asked again when the object is down (it may have landed): the round ends and the run starts over.
  const dead = (u: string | null, url: string, init?: RequestInit) => init?.method === "POST" && url.includes("/ops") ? Promise.reject(new Error("reset")) : call(u, url, init);
  const exec: Exec = async (_c, cwd) => { writeFileSync(join(cwd, "a.js"), "one\nTWO\nthree\nfour\n"); return { code: 0, out: "" }; };
  await expect(runAgent(dead, { user: "agent-x", owner: "ryan", repo: "lab", path: "a.js", harness: "claude", task: "x", exec, pause: async () => {} })).rejects.toBeInstanceOf(Interrupted);
  expect((await doc()).lines.map((l) => l.text)).toEqual(["one", "two", "three", "four"]);
});

test("a desktop run the app quit on starts again from the file, and its first attempt's tokens count toward the budget", async () => {
  const { call, doc } = await app();
  call.env.AGENT_REVIEW_MS = "0";
  call.env.AGENT_EXEC = (async (_c, cwd) => { writeFileSync(join(cwd, "a.js"), "one\nTWO\nthree\nfour\n"); return { code: 0, out: "done" }; }) satisfies Exec;
  // Run 1 spent 12345 tokens before the app quit; nothing in this process knows it.
  const sql = "INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started, picked, result) VALUES ('ryan', 'lab', 'a.js', 'claude', 'shout', 'agent-x', 'running', ?, 1, ?) RETURNING id";
  const id = (await call.env.DB.prepare(sql).bind(Date.now() - 1000, JSON.stringify({ progress: { runs: 1, applied: 0, spent: 12345 } })).first() as { id: number }).id;
  const runs = async () => (await (await call("ryan", "/api/repos/ryan/lab/agents?path=a.js")).json() as any[]).find((r) => r.id === id);

  // The app comes back and the listing finds it cut off: it goes round again instead of failing.
  expect(await runs()).toMatchObject({ restarts: 1 });
  for (let i = 0; i < 300 && (await runs()).status === "running"; i++) await Bun.sleep(20);
  const done = await runs();
  expect(done).toMatchObject({ status: "done", restarts: 1, applied: 1 });
  expect(done.log).toContain("interrupted by update, retrying");
  expect(done.spent).toBeGreaterThan(12345);
  expect((await doc()).lines.map((l) => l.text)).toEqual(["one", "TWO", "three", "four"]);
});
