// The office's everyday actions as commands (@rustybuns/util/commands): who's at a desk, hire a worker for a task,
// tell one something, send one home. Each is a WebMCP tool for an agent in the browser (on the signed-in page, no
// hook token) and on window.__commands for a script or `bun run probe`. They go over the page's own socket, the
// messages the office's buttons send, so the office's toasts and warnings say how each went.
//
// No second Cmd/Ctrl+K palette: the office has its own (workers, issues, PRs, boards and actions), and the shared
// one would take its key.
import { addCommands } from "@rustybuns/util/commands";
import { arr, check, int, maybe, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";

const Worker = obj({ id: str(100), name: str(200), status: maybe(str(100)), kind: maybe(str(20)), activity: maybe(str(500)), worktree: maybe(obj({ branch: maybe(str(300)) })) });
type Worker = Of<typeof Worker>;
const Msg = obj({ t: str(100), workers: maybe(arr(Worker, 500, { drop: true })), worker: maybe(Worker), workerId: maybe(str(100)) });

const workers = new Map<string, Worker>();
let sock: WebSocket | undefined;

/** One socket frame, as the office's client reads it: a floor's workers, one changed, one gone. */
function hear(data: unknown) {
  if (typeof data !== "string" || !data.startsWith("{")) return;
  let raw: unknown;
  try { raw = JSON.parse(data); } catch { return; }
  const m = check(Msg, raw);
  if (!m) return;
  if (m.t === "floor.enter" && m.workers) { workers.clear(); for (const w of m.workers) workers.set(w.id, w); }
  else if (m.t === "worker.update" && m.worker) workers.set(m.worker.id, m.worker);
  else if (m.t === "worker.remove" && m.workerId) workers.delete(m.workerId);
}

// the client's socket, with one more listener, added before the office's bundle opens it
const Native = window.WebSocket;
window.WebSocket = class extends Native {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    sock = this;
    this.addEventListener("message", (e) => hear(e.data));
  }
};

function send(msg: Record<string, unknown>) {
  if (!sock || sock.readyState !== Native.OPEN) throw new Error("The office isn't connected: reload the page, or sign in first");
  sock.send(JSON.stringify(msg));
}

/** A worker on this floor by its id or name (any case, the shell's 🐚 left off). */
function find(who: string): Worker {
  const k = who.trim().toLowerCase();
  const w = workers.get(who) ?? [...workers.values()].find((x) => x.name.toLowerCase().replace(/\s*🐚$/u, "") === k);
  if (!w) throw new Error(`No worker "${who}" on this floor: ${[...workers.values()].map((x) => x.name).join(", ") || "nobody's at a desk"}`);
  return w;
}

const Hire = obj({ prompt: str(20000), title: opt(str(200)), issue: opt(int(1, 1e9)), provider: opt(str(40)), model: opt(str(100)), effort: opt(oneOf(["low", "medium", "high", "xhigh", "max"])) });
const Tell = obj({ worker: str(200), prompt: str(20000) });
const Home = obj({ worker: str(200), cleanup: opt(oneOf(["auto", "keep", "worktree", "all"])) });
const WHO = { type: "string", description: "The worker's name or id (office_workers lists them)" };

addCommands([
  { name: "office_workers", title: "Who's at a desk", group: "Office", annotations: { readOnlyHint: true },
    description: "The workers on this floor: id, name, status (working, idle, needs_input, ...), kind (agent or shell), what it's on and its branch.",
    execute: () => [...workers.values()].map((w) => ({ id: w.id, name: w.name, status: w.status, kind: w.kind, activity: w.activity, branch: w.worktree?.branch })) },
  { name: "office_hire", title: "Hire a worker for a task", group: "Office", annotations: { destructiveHint: true },
    description: "Put a task on this floor's queue; the office seats a new worker at the next free desk to do it (in its own worktree), on the sign-ins of whoever is signed in here. Costs a worker's run: ask the person first.",
    inputSchema: { type: "object", properties: { prompt: { type: "string", description: "The task" }, title: { type: "string" }, issue: { type: "integer", description: "A GitHub issue number it closes" },
      provider: { type: "string" }, model: { type: "string" }, effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"] } }, required: ["prompt"] },
    execute: (a) => { const h = Hire(a); send({ t: "queue.add", ...h, title: h.title ?? h.prompt.split("\n")[0]!.slice(0, 80) }); return { queued: true }; } },
  { name: "office_tell", title: "Tell a worker", group: "Office", annotations: { destructiveHint: true },
    description: "Type a prompt into a worker's terminal, as the office's Prompt box does (queued in its input when it's busy).",
    inputSchema: { type: "object", properties: { worker: WHO, prompt: { type: "string" } }, required: ["worker", "prompt"] },
    execute: (a) => { const { worker, prompt } = Tell(a); const w = find(worker); send({ t: "worker.prompt", workerId: w.id, prompt }); return { told: w.name }; } },
  { name: "office_send_home", title: "Send a worker home", group: "Office", annotations: { destructiveHint: true },
    description: "Send a worker home: it stops and leaves its desk. cleanup says what happens to its worktree (auto, keep, worktree, all), the office's default when left out. Ask the person first.",
    inputSchema: { type: "object", properties: { worker: WHO, cleanup: { type: "string", enum: ["auto", "keep", "worktree", "all"] } }, required: ["worker"] },
    execute: (a) => { const { worker, cleanup } = Home(a); const w = find(worker); send({ t: "worker.kill", workerId: w.id, ...(cleanup && { cleanup }) }); return { sentHome: w.name }; } },
]);
