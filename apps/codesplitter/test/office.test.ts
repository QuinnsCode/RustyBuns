// The Agent Office floor (src/office.ts, #3423 slice 1): the owner walks a floor's queue, desks and roster through
// its socket and its routes, a worker reports in with its hook token, and the floor outlives its object.
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { local, post } from "./app-kit.ts";
import type { Exec } from "../src/agent-run.ts";

test("the owner runs a floor's queue and roster, a worker reports with its token, and it all survives an eviction", async () => {
  const call = await local({ OFFICE: true, ADMINS: "quinn" });

  // The floor's socket: a welcome with the empty floor, then every change as the office's own messages.
  const res = await call("quinn", "/api/office/main/ws", { headers: { upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const sock = (res as any).webSocket;
  const heard: any[] = sock.queue.splice(0).map((d: string) => JSON.parse(d));
  sock.toBrowser = (d: string) => heard.push(JSON.parse(d));
  const said = async (m: unknown) => { sock.onMessage(JSON.stringify(m)); await Bun.sleep(20); };
  expect(heard[0]).toMatchObject({ t: "welcome", floor: "main", workers: [], queue: { tasks: [], maxWorkers: 3 } });

  await said({ t: "queue.add", prompt: "Fix the login page\nIt 500s on a long email", issue: 12 });
  await said({ t: "queue.add", prompt: "Add a dark mode" });
  await said({ t: "queue.add", prompt: "again", issue: 12 });
  expect(heard.at(-1)).toEqual({ t: "toast", text: "Issue #12 is already on the queue", level: "warn" });
  const second = heard.filter((m) => m.t === "queue").at(-1).state.tasks[1];
  await said({ t: "queue.move", taskId: second.id, delta: -1 });
  const queue = heard.filter((m) => m.t === "queue").at(-1).state;
  expect(queue.tasks.map((t: any) => [t.title, t.addedBy, t.status])).toEqual([["Add a dark mode", "quinn", "queued"], ["Fix the login page", "quinn", "queued"]]);

  // A hire seats a worker and hands its hook token back once; the socket hears the worker, not the token.
  const hire = await (await post(call, "quinn", "/api/office/main", { t: "worker.spawn", deskId: "desk-3", name: "Bolt", prompt: "Fix the login page" })).json() as any;
  expect(hire.worker).toMatchObject({ name: "Bolt", deskId: "desk-3", status: "offline", createdBy: "quinn" });
  expect(hire.desks.find((d: any) => d.id === "desk-3").workerId).toBe(hire.worker.id);
  expect(heard.at(-1)).toEqual({ t: "worker.update", worker: hire.worker });
  expect((await post(call, "quinn", "/api/office/main", { t: "worker.spawn", deskId: "desk-3" })).status).toBe(400);

  // The worker reports in with its own token; someone else's guess is turned away.
  const hook = (token: string) => call(null, `/api/office/main/hook?worker=${hire.worker.id}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ status: "working", activity: "reading login.ts" }) });
  expect((await hook("not-the-token")).status).toBe(401);
  expect((await hook(hire.hookToken)).status).toBe(200);
  expect(heard.at(-1)).toMatchObject({ t: "worker.update", worker: { id: hire.worker.id, status: "working", activity: "reading login.ts" } });

  // Only the owner, and only a floor with a name: a junk one makes no object.
  expect((await call("ana", "/api/office/main")).status).toBe(403);
  expect((await call(null, "/api/office/main")).status).toBe(401);
  expect((await call("quinn", "/api/office/Main%20Floor!")).status).toBe(404);

  // A deploy or hibernation drops the object; the floor comes back from its SQLite as it was.
  expect(call.env.OFFICE.evict(call.env.OFFICE.idFromName("floor:main"))).toBe(true);
  const back = await (await call("quinn", "/api/office/main")).json() as any;
  expect(back.queue.tasks.map((t: any) => t.title)).toEqual(["Add a dark mode", "Fix the login page"]);
  expect(back.workers.map((w: any) => [w.name, w.status])).toEqual([["Bolt", "working"]]);
  expect(JSON.stringify(back)).not.toContain(hire.hookToken);

  // Sent home, the desk is free; clear leaves the waiting tasks.
  await said({ t: "worker.kill", workerId: hire.worker.id });
  expect(heard.at(-1)).toEqual({ t: "worker.remove", workerId: hire.worker.id });
  await said({ t: "queue.clear" });
  const end = await (await call("quinn", "/api/office/main")).json() as any;
  expect([end.workers, end.queue.tasks.length]).toEqual([[], 2]);
});

test("a hire with a repo and a file puts an agent run at the desk; the board shows its branch and output", async () => {
  const call = await local({ OFFICE: true, ADMINS: "quinn" });
  call.env.AGENT_EXEC = (async (cmd, cwd) => {
    const f = join(cwd, "a.js");
    writeFileSync(f, readFileSync(f, "utf8").toUpperCase());
    return { code: 0, out: `${cmd.bin} shouted a.js` };
  }) satisfies Exec;
  call.env.AGENT_REVIEW_MS = "60000"; // the batch waits on its branch while the board looks
  await post(call, "quinn", "/api/login", { name: "quinn" });
  await post(call, "quinn", "/api/repos", { name: "lab", visibility: "public" });
  await post(call, "quinn", "/api/repos/quinn/lab/files", { path: "a.js", content: "let a = 1" });
  const floor = async () => await (await call("quinn", "/api/office/main")).json() as any;

  // A run needs a file and a task, and one the agents route refuses leaves the desk free.
  const bad = await post(call, "quinn", "/api/office/main", { t: "worker.spawn", deskId: "desk-2", repo: "quinn/lab", path: "a.js", prompt: "shout", provider: "nobody" });
  expect(bad.status).toBe(400);
  expect((await floor()).workers).toEqual([]);

  const res = await post(call, "quinn", "/api/office/main", { t: "worker.spawn", deskId: "desk-2", name: "Bolt", repo: "quinn/lab", path: "a.js", prompt: "shout" });
  expect(res.status).toBe(202);
  const hire = await res.json() as any;
  expect(hire.worker).toMatchObject({ name: "Bolt", deskId: "desk-2", status: "working", run: { owner: "quinn", repo: "lab", path: "a.js", agent: "agent-claude", status: "running" } });

  // When the run ends, its desk hears: done, the branch its batch waits on, and what the agent said.
  let w: any;
  for (const end = performance.now() + 15_000; performance.now() < end && (w = (await floor()).workers[0]).run.status === "running";) await Bun.sleep(20);
  expect(w).toMatchObject({ status: "done", run: { status: "done", branch: `agent-run-${hire.worker.run.id}`, output: "claude shouted a.js" } });
  // It edited on that branch under its own name, so blame shows the agent.
  const doc = await (await call("quinn", `/api/repos/quinn/lab/do/file?path=a.js&branch=${w.run.branch}`)).json() as { lines: { text: string; by: string }[] };
  expect(doc.lines.map((l) => [l.text, l.by])).toEqual([["LET A = 1", "agent-claude"]]);
});

// The 3D client (#3423 slice 2) makes its own calls, rewritten under /api/office/ by src/office-client.ts.
test("the 3D client signs in, opens its floor by ?floor= and gets a welcome it can draw, live", async () => {
  const call = await local({ OFFICE: true, ADMINS: "quinn" });
  expect(await (await call("quinn", "/api/office/whoami")).json()).toEqual({ me: { account: { name: "quinn", role: "admin" }, admin: true } });
  expect((await call(null, "/api/office/whoami")).status).toBe(401);

  // The client's socket URL: the floor and the look it picked in the query, as upstream's client sends them.
  const res = await call("quinn", "/api/office/ws?floor=grove&name=quinn&color=%23e76f51&skin=2&hair=3&style=1", { headers: { upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const sock = (res as any).webSocket;
  const heard: any[] = sock.queue.splice(0).map((d: string) => JSON.parse(d));
  sock.toBrowser = (d: string) => heard.push(JSON.parse(d));
  const welcome = heard[0];
  expect(welcome).toMatchObject({ t: "welcome", floor: "grove", floors: [{ id: "grove", people: 1 }], queue: { tasks: [] }, workers: [] });
  expect(welcome.peers).toEqual([expect.objectContaining({ id: welcome.you, name: "quinn", color: "#e76f51", look: { skin: 2, hair: 3, style: 1 }, floor: "grove" })]);

  // Its chatter the floor doesn't keep yet is dropped quietly; a ping gets its pong; a task added elsewhere shows up.
  const said = async (m: unknown) => { sock.onMessage(JSON.stringify(m)); await Bun.sleep(20); };
  await said({ t: "peer.move", x: 1, z: 2 });
  await said({ t: "ping", at: 12.5 });
  expect(heard.slice(1)).toEqual([{ t: "pong", at: 12.5, now: expect.any(Number) }]);
  await post(call, "quinn", "/api/office/grove", { t: "queue.add", prompt: "Water the ferns" });
  expect(heard.at(-1)).toMatchObject({ t: "queue", state: { tasks: [{ title: "Water the ferns" }] } });
  // The client's paths aren't floors.
  expect((await call("quinn", "/api/office/whoami/ws")).status).toBe(404);
});
