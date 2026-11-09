// The Agent Office floor (src/office.ts, #3423 slice 1): the owner walks a floor's queue, desks and roster through
// its socket and its routes, a worker reports in with its hook token, and the floor outlives its object.
import { expect, test } from "bun:test";
import { local, post } from "./app-kit.ts";

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
