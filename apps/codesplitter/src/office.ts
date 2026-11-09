// The Agent Office floor (#3423 slice 1, apps/agent-office/MOVE.md "Build order"): one OfficeFloor Durable Object per
// floor, SQLite-backed, holding the task queue, the desks and the worker roster. Bound on the office-preview stage only.
// It speaks the office's own socket messages (the local binary's server/ws/handlers/queue.js and workers.js), so the
// 3D client (slice 2) can talk to it unchanged:
//   in:  queue.add {prompt, title?, issue?, provider?}, queue.remove {taskId}, queue.move {taskId, delta},
//        queue.clear, queue.limit {maxWorkers}, worker.spawn {deskId?, prompt?, name?}, worker.kill {workerId}
//   out: welcome {you, floor, workers, queue}, queue {state}, worker.update {worker}, worker.remove {workerId},
//        toast {text, level}
// Nothing runs at a desk yet (slice 3): a hire seats a worker and hands back its hook token once; only its sha256 is
// kept, as workers.json does since #642. Sockets hibernate (ctx.acceptWebSocket) and there's no tick loop.
//
//   GET  /api/office/:floor              the floor: queue, workers, desks
//   POST /api/office/:floor {t, ...}     one of the messages above; a worker.spawn answers with its hookToken
//   GET  /api/office/:floor/ws           the floor's socket
//   POST /api/office/:floor/hook?worker=<id> {status?, activity?}  a worker's own report, its hook token as the bearer
// Until auth mapping (slice 7), everything but the hook takes the signed-in owner only.

import { arr, check, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { fail, json, type Env } from "./env.ts";
import { sha256 } from "./util.ts";

/** A floor's name, checked before idFromName so a junk URL makes no object. */
export const FLOOR_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** The office's desks (shared/layout.ts DESKS: two pods of eight). */
export const DESKS = Array.from({ length: 16 }, (_, i) => ({ id: `desk-${i + 1}`, label: `Desk ${i + 1}` }));
const MAX_TASKS = 100, DEFAULT_MAX_WORKERS = 3;
const STATUSES = ["starting", "working", "idle", "done", "exited", "offline"] as const;
const COLORS = ["#4f86f7", "#e76f51", "#2a9d8f", "#e9c46a", "#9b5de5", "#f15bb5", "#00bbf9", "#90be6d"];

const Task = obj({
  id: str(32), provider: str(32), issue: opt(int(1, 1e9)), title: str(120), prompt: str(20000), addedBy: str(64),
  addedAt: int(0, 1e15), status: oneOf(["queued", "running", "done"]),
});
export type Task = Of<typeof Task>;
const Worker = obj({
  id: str(32), kind: oneOf(["agent", "shell"]), provider: str(32), deskId: str(32), name: str(64), color: str(16),
  status: oneOf(STATUSES), createdBy: str(64), createdAt: int(0, 1e15), prompt: opt(str(20000)),
  activity: opt(str(200)), cols: int(1, 1000), rows: int(1, 1000), viewers: arr(str(64), 64), viewerIds: arr(str(64), 64),
});
export type Worker = Of<typeof Worker>;
/** What GET answers and the welcome carries of the floor. */
export type FloorState = { floor: string; workers: Worker[]; queue: { tasks: Task[]; maxWorkers: number }; desks: { id: string; label: string; workerId?: string }[] };

const Msg = obj({
  t: str(32), prompt: opt(str(20000, { min: 0 })), title: opt(str(200, { min: 0 })), issue: opt(int(1, 1e9)),
  provider: opt(str(32)), taskId: opt(str(32)), delta: opt(int(-1e6, 1e6)), maxWorkers: opt(int(0, 1e6)),
  deskId: opt(str(32)), name: opt(str(24)), workerId: opt(str(32)),
});
type Msg = Of<typeof Msg>;
const Hook = obj({ status: opt(oneOf(STATUSES)), activity: opt(str(200, { min: 0 })) });

const hexId = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const firstLine = (s: string) => s.split("\n")[0]!.trim();

type Sql = { exec<T = Record<string, unknown>>(q: string, ...args: unknown[]): { toArray(): T[]; one(): T } };
type Ctx = RoomCtx & { storage: { sql: Sql } };
/** Who a socket is: the office's id for them, and the person. */
type Peer = { you: string; by: string };

/** One floor of the office. Each change is written to SQLite before anyone hears about it. */
export class OfficeFloor {
  sql: Sql;
  sockets: Sockets<Peer>;
  constructor(ctx: Ctx, _env: unknown) {
    this.sql = ctx.storage.sql;
    this.sockets = new Sockets<Peer>(ctx, { maxBytes: 40_000, rate: 20, burst: 40 });
    this.sql.exec("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, pos INTEGER NOT NULL, body TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, desk TEXT NOT NULL UNIQUE, hook_hash TEXT NOT NULL, body TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  tasks(): Task[] {
    return this.sql.exec<{ body: string }>("SELECT body FROM tasks ORDER BY pos").toArray().flatMap((r) => check(Task, JSON.parse(r.body)) ?? []);
  }
  workers(): Worker[] {
    return this.sql.exec<{ body: string }>("SELECT body FROM workers ORDER BY desk").toArray().flatMap((r) => check(Worker, JSON.parse(r.body)) ?? []);
  }
  maxWorkers(): number {
    const r = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'maxWorkers'").toArray()[0];
    return r ? Number(r.value) : DEFAULT_MAX_WORKERS;
  }
  queue() { return { tasks: this.tasks(), maxWorkers: this.maxWorkers() }; }
  state(floor: string): FloorState {
    const workers = this.workers(), at = new Map(workers.map((w) => [w.deskId, w.id]));
    return { floor, workers, queue: this.queue(), desks: DESKS.map((d) => ({ ...d, ...(at.has(d.id) ? { workerId: at.get(d.id) } : {}) })) };
  }

  saveTasks(tasks: Task[]) {
    this.sql.exec("DELETE FROM tasks");
    tasks.forEach((t, i) => this.sql.exec("INSERT INTO tasks (id, pos, body) VALUES (?, ?, ?)", t.id, i, JSON.stringify(t)));
    this.broadcast({ t: "queue", state: this.queue() });
  }
  saveWorker(w: Worker) {
    this.sql.exec("UPDATE workers SET body = ? WHERE id = ?", JSON.stringify(w), w.id);
    this.broadcast({ t: "worker.update", worker: w });
  }

  broadcast(msg: unknown) { this.sockets.broadcast(msg); }

  /** One message from `by`: an error to tell them, or what it made (a hire's worker and token). */
  async apply(m: Msg, by: string): Promise<{ error: string } | { worker: Worker; hookToken: string } | null> {
    const tasks = this.tasks();
    switch (m.t) {
      case "queue.add": {
        const prompt = (m.prompt ?? "").replace(/\r\n?/g, "\n").trim();
        if (!prompt) return { error: "Empty task" };
        if (m.issue !== undefined && tasks.some((t) => t.issue === m.issue && t.status !== "done")) return { error: `Issue #${m.issue} is already on the queue` };
        if (tasks.filter((t) => t.status !== "done").length >= MAX_TASKS) return { error: `The queue is full (${MAX_TASKS} tasks)` };
        tasks.push({
          id: hexId(6), provider: m.provider ?? "claude", ...(m.issue !== undefined ? { issue: m.issue } : {}),
          title: (m.title?.trim() || firstLine(prompt)).slice(0, 120), prompt, addedBy: by, addedAt: Date.now(), status: "queued",
        });
        this.saveTasks(tasks);
        return null;
      }
      case "queue.remove": {
        const t = tasks.find((x) => x.id === m.taskId);
        if (!t) return { error: "No such task" };
        if (t.status === "running") return { error: "Its worker is on it: send the worker home to stop it" };
        this.saveTasks(tasks.filter((x) => x !== t));
        return null;
      }
      case "queue.move": {
        // One place up (delta < 0) or down among the queued tasks, as the office does.
        const queued = tasks.filter((t) => t.status === "queued");
        const i = queued.findIndex((t) => t.id === m.taskId), j = i + ((m.delta ?? 1) < 0 ? -1 : 1);
        if (i < 0 || j < 0 || j >= queued.length) return null;
        const a = tasks.indexOf(queued[i]!), b = tasks.indexOf(queued[j]!);
        [tasks[a], tasks[b]] = [tasks[b]!, tasks[a]!];
        this.saveTasks(tasks);
        return null;
      }
      case "queue.clear": {
        const left = tasks.filter((t) => t.status !== "done");
        if (left.length !== tasks.length) this.saveTasks(left);
        return null;
      }
      case "queue.limit": {
        const v = Math.max(0, Math.min(DESKS.length, m.maxWorkers ?? DEFAULT_MAX_WORKERS));
        this.sql.exec("INSERT INTO meta (key, value) VALUES ('maxWorkers', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", String(v));
        this.broadcast({ t: "queue", state: this.queue() });
        return null;
      }
      case "worker.spawn": {
        const workers = this.workers(), taken = new Set(workers.map((w) => w.deskId));
        const desk = m.deskId ? DESKS.find((d) => d.id === m.deskId) : DESKS.find((d) => !taken.has(d.id));
        if (!desk) return { error: m.deskId ? "No such desk" : "Every desk is taken" };
        if (taken.has(desk.id)) return { error: "That desk is taken" };
        const prompt = m.prompt?.trim() || undefined;
        const w: Worker = {
          id: hexId(5), kind: "agent", provider: m.provider ?? "claude", deskId: desk.id, name: m.name?.trim() || `Worker ${desk.id.slice(5)}`,
          color: COLORS[workers.length % COLORS.length]!, status: "offline", createdBy: by, createdAt: Date.now(),
          ...(prompt ? { prompt, activity: firstLine(prompt).slice(0, 80) } : {}), cols: 100, rows: 30, viewers: [], viewerIds: [],
        };
        // The token goes back to the hire once; the floor keeps only its hash (#642).
        const hookToken = hexId(24);
        this.sql.exec("INSERT INTO workers (id, desk, hook_hash, body) VALUES (?, ?, ?, ?)", w.id, w.deskId, await sha256(hookToken), JSON.stringify(w));
        this.broadcast({ t: "worker.update", worker: w });
        return { worker: w, hookToken };
      }
      case "worker.kill": {
        if (!this.workers().some((w) => w.id === m.workerId)) return { error: "No such worker" };
        this.sql.exec("DELETE FROM workers WHERE id = ?", m.workerId);
        this.broadcast({ t: "worker.remove", workerId: m.workerId });
        return null;
      }
      default: return { error: "Unknown message" };
    }
  }

  /** A worker's own report, when its token's hash is the one on file. */
  async hook(workerId: string, token: string, body: unknown): Promise<Response> {
    const row = this.sql.exec<{ hook_hash: string; body: string }>("SELECT hook_hash, body FROM workers WHERE id = ?", workerId).toArray()[0];
    const w = row && check(Worker, JSON.parse(row.body));
    if (!w || !token || (await sha256(token)) !== row.hook_hash) return fail("BadHookToken", "Send your own worker id as ?worker= and its hook token as the bearer token");
    const h = check(Hook, body);
    if (!h) return fail("BadInput", "send {status?, activity?}");
    const next: Worker = { ...w, ...(h.status ? { status: h.status } : {}), ...(h.activity !== undefined ? { activity: h.activity } : {}) };
    this.saveWorker(next);
    return json({ worker: next });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url), floor = url.searchParams.get("floor") ?? "", by = req.headers.get("x-codesplitter-user") ?? "owner";
    if (url.pathname === "/ws") {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return fail("BadInput", "this is the floor's socket: open it as a WebSocket");
      const you = hexId(5), { server, response } = this.sockets.upgrade({ you, by });
      const { desks: _, ...view } = this.state(floor);
      this.sockets.send(server, { t: "welcome", you, ...view });
      return response;
    }
    if (url.pathname === "/hook") return this.hook(url.searchParams.get("worker") ?? "", (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""), await req.json().catch(() => null));
    if (req.method === "GET") return json(this.state(floor));
    const m = check(Msg, await req.json().catch(() => null));
    if (!m) return fail("BadInput", "send one of the office's messages, {t: \"queue.add\", prompt}");
    const r = await this.apply(m, by);
    if (r && "error" in r) return fail("BadInput", r.error);
    return json({ ok: true, ...(r ?? {}), ...this.state(floor) });
  }

  async webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const f = this.sockets.frame(ws, raw), m = f && check(Msg, f.value), me = this.sockets.who(ws);
    if (!m || !me) return;
    const r = await this.apply(m, me.by);
    if (r && "error" in r) this.sockets.send(ws, { t: "toast", text: r.error, level: "warn" });
  }

  webSocketClose() {}
}

/** POST /api/office/:floor/hook: before the API-token check, since its bearer is a worker's hook token, not a person's. */
export function officeHook(req: Request, env: Env, p: string[], url: URL): Promise<Response> | null {
  if (p[1] !== "office" || p[3] !== "hook" || p[4] || req.method !== "POST") return null;
  const stub = floorStub(env, p[2]);
  if (stub instanceof Response) return Promise.resolve(stub);
  return stub.fetch(new Request(`https://office/hook?worker=${encodeURIComponent(url.searchParams.get("worker") ?? "")}`, {
    method: "POST", headers: { authorization: req.headers.get("authorization") ?? "" }, body: req.body,
  }));
}

/** The floor's object, once its name passes; a Response when it doesn't, or when this stage has no office. */
function floorStub(env: Env, floor: string | undefined) {
  if (!env.OFFICE) return fail("NoSuchRoute", "no office on this stage (it's on office-preview)");
  if (!floor || !FLOOR_NAME.test(floor)) return fail("NoSuchFloor", "a floor's name is up to 32 lowercase letters, digits and -");
  return env.OFFICE.get(env.OFFICE.idFromName(`floor:${floor}`));
}

/** The rest of /api/office/:floor, for the signed-in owner only until auth mapping (slice 7). */
export async function officeRoutes(req: Request, env: Env, p: string[], user: string | null, owner: boolean): Promise<Response | null> {
  if (p[1] !== "office") return null;
  const floor = p[2], rest = p[3];
  if (p[4] || (rest !== undefined && rest !== "ws")) return fail("NoSuchRoute", "no API route there");
  if (!user) return fail("SignInFirst", "sign in first");
  if (!owner) return fail("AdminsOnly", "the office takes its owner only, until sign-in mapping lands (#3423)");
  const stub = floorStub(env, floor);
  if (stub instanceof Response) return stub;
  const to = `https://office/${rest ?? ""}?floor=${floor}`;
  if (rest === "ws") {
    const h = new Headers(req.headers);
    h.set("x-codesplitter-user", user);
    return stub.fetch(new Request(to, { headers: h }));
  }
  if (req.method === "GET") return stub.fetch(new Request(to));
  if (req.method !== "POST") return fail("NoSuchRoute", "GET the floor, or POST it a message");
  return stub.fetch(new Request(to, { method: "POST", headers: { "x-codesplitter-user": user }, body: await req.text() }));
}
