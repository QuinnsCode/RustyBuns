// #4663: a prompt to a worker whose agent died with no exit heard used to be typed into a dead terminal and lost.
import { expect, setDefaultTimeout } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { endedClicks, endedManager } from "../scripts/ended.ts";
import { beforePinned, pinnedTest, unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(60_000);

type Handler = (ctx: unknown, c: unknown, msg: unknown) => void;
let WorkerManager: { prototype: object };
let workerHandlers: Record<string, Handler>;
beforePinned(async () => {
  const srv = path.join(await unpackPinned(), "dist/server/server");
  writeFileSync(path.join(srv, "rb-ended.js"), `export * from ${JSON.stringify(path.join(import.meta.dir, "../live/ended.ts"))};\n`);
  // the release's node_modules aren't installed here: keep only our import, and hand the methods the few names they use
  const strip = (js: string) => js.replace(/^import (?!.*rb-ended).*$/gm, "");
  const manager = path.join(srv, "workers/manager.js");
  writeFileSync(manager, strip(endedManager(readFileSync(manager, "utf8"))));
  const ws = path.join(srv, "ws/handlers/workers.js");
  writeFileSync(ws, strip(endedClicks(readFileSync(ws, "utf8"))));
  Object.assign(globalThis, {
    clockWork: () => {},
    truncate: (s: string, n: number) => s.slice(0, n),
    DESK_BY_ID: new Map(),
    str: (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : ""),
    issueNumber: () => undefined,
    workerOf: (ctx: { floor: { workers: { get(id: string): unknown } } }, id: string) => ({ floor: ctx.floor, info: ctx.floor.workers.get(id), wid: id }),
  });
  ({ WorkerManager } = await import(manager));
  ({ workerHandlers } = await import(ws));
});

/** Sprocket at Desk 3, `done`, holding the terminal of an agent that has already exited (its exit never heard). */
async function deadDesk() {
  const agent = Bun.spawn(["sleep", "30"]);
  agent.kill();
  await agent.exited;
  const typed: string[] = [], screen: string[] = [], toasts: string[] = [], launched: (string | undefined)[] = [];
  const info = { id: "w1", name: "Sprocket", kind: "agent", deskId: "d3", status: "idle", sessionId: "fb618739", activity: "" } as Record<string, unknown>;
  const w = { info, pty: { pid: agent.pid, write: (s: string) => typed.push(s), kill: () => {} }, viewers: new Map(), term: { write: (s: string) => screen.push(s) } };
  const manager = Object.assign(Object.create(WorkerManager.prototype), {
    workers: new Map([["w1", w]]),
    events: { toast: (m: string) => toasts.push(m), update: () => {}, data: () => {} },
    tasks: { notePrompt: () => {} },
    worktrees: { checkLost: () => false },
    persist: () => {},
    // where the real one starts the agent again with --resume and this as its first message
    launch: (_w: unknown, prompt: string | undefined) => launched.push(prompt),
  });
  return { manager, info, typed, screen, toasts, launched };
}

pinnedTest("a prompt typed at a dead worker's desk wakes it with that prompt; a told one gets what tell resumes on", async () => {
  const desk = await deadDesk();
  const sent: { t: string; text?: string }[] = [], warned: unknown[] = [];
  const ctx = { floor: { workers: desk.manager }, warn: (_c: unknown, e: unknown) => e && warned.push(e), sendTo: (_c: unknown, m: { t: string }) => sent.push(m) };
  const prompt = "I need you to lead two workers to spike out and finish out qview3d\nin a form the owner can use";
  workerHandlers["worker.prompt"]!(ctx, { peer: { name: "Ryan" } }, { workerId: "w1", prompt });

  // nothing went into the dead terminal: the session ended, and the whole prompt starts it again
  expect(desk.typed).toEqual([]);
  expect(desk.launched).toEqual([prompt]);
  expect(warned).toEqual([]);
  expect(desk.screen.join("")).toContain("Sprocket's session ended");
  expect(desk.toasts).toEqual(["Sprocket's session had ended"]);
  expect(sent.map((m) => m.text)).toEqual(["Sprocket wasn't running: it is starting again with your prompt"]);
  expect(desk.info.status).toBe("starting");

  // office-workers tell resumes on exactly this answer
  const told = await deadDesk();
  expect(told.manager.prompt("w1", "rebase onto main", "Pixel")).toBe("Worker is not running");
  expect(told.typed).toEqual([]);
  expect(told.info.status).toBe("exited");
});

pinnedTest("a key typed into a dead worker's terminal shows the desk asleep; a live worker is typed into as before", async () => {
  const desk = await deadDesk();
  desk.manager.write("w1", "y", "Ryan");
  expect(desk.typed).toEqual([]);
  expect(desk.info).toMatchObject({ status: "exited", activity: "Session ended" });

  const live = await deadDesk();
  const agent = Bun.spawn(["sleep", "30"]);
  try {
    live.manager.workers.get("w1").pty.pid = agent.pid;
    expect(live.manager.prompt("w1", "carry on", "Ryan")).toBeUndefined();
    expect(live.typed).toEqual(["\x1b[200~carry on\x1b[201~"]);
    expect(live.info.status).toBe("idle");
  } finally {
    agent.kill();
  }
});
