import { afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fromWorker, peopleOnly } from "../live/floorguard.ts";
import { floorGuardHooks } from "../scripts/floorguard.ts";
import { unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(60_000);

let officeWorkers: (ctx: unknown, req: unknown, res: unknown, url: URL) => Promise<void>;
beforeAll(async () => {
  const srv = path.join(await unpackPinned(), "dist/server/server");
  const file = path.join(srv, "hooks/office-workers.js");
  writeFileSync(file, floorGuardHooks(readFileSync(file, "utf8")));
  writeFileSync(path.join(srv, "rb-floorguard.js"), `export * from ${JSON.stringify(path.join(import.meta.dir, "../live/floorguard.ts"))};\n`);
  ({ officeWorkers } = await import(file));
});
afterEach(() => delete process.env.AGENT_OFFICE_PEOPLE_ONLY);

const worker = (id: string, name: string) =>
  ({ id, name, kind: "agent", deskId: "", status: "idle", viewers: [], createdAt: 0, createdBy: "you" }) as Record<string, unknown>;

/** A floor with Pixel (asking) and Sprocket, whose worktree holds `dirty` uncommitted changes. */
function office(dirty: number) {
  const ws = [worker("w1", "Pixel"), worker("w2", "Sprocket")];
  const seen = { toasts: [] as string[], homes: [] as unknown[], told: [] as string[] };
  const floor = {
    id: "f",
    github: { pulls: { items: [] } },
    queue: { state: () => ({ tasks: [] }) },
    landed: () => undefined,
    sendHome: async (_id: string, cleanup: unknown) => (seen.homes.push(cleanup), { note: "went" }),
    workers: {
      authenticate: (id: string) => ws.find((w) => w.id === id),
      list: () => ws,
      get: (id: string) => ws.find((w) => w.id === id),
      inspectWorktree: async () => ({ exists: true, dirty, ahead: 0, unpushed: 0 }),
      prompt: (_id: string, text: string) => (seen.told.push(text), undefined),
    },
  };
  const ctx = { workerFloor: () => floor, floors: new Map([["f", floor]]), toastFloor: (_f: unknown, m: string) => seen.toasts.push(m) };
  return { ctx, seen, ws };
}

async function call(ctx: unknown, action: string, body: unknown) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: "POST", headers: { authorization: "Bearer t" } });
  const res = { status: 0, body: {} as any, writeHead(s: number) { this.status = s; }, end(j: string) { this.body = JSON.parse(j); } };
  await officeWorkers(ctx, req, res, new URL(`http://127.0.0.1/office/workers${action}?worker=w1`));
  return res;
}

test("a forced send_home keeps another worker's uncommitted work, and says only a person can throw it away", async () => {
  const { ctx, seen } = office(2);
  const res = await call(ctx, "/home", { workers: ["Sprocket"], cleanup: "all" });
  expect(res.status).toBe(200);
  expect(seen.homes).toEqual([undefined]);
  expect(res.body.results[0].held).toContain("2 uncommitted changes");
  expect(seen.toasts.some((t) => t.includes("only a person"))).toBe(true);
});

test("a forced send_home of a clean worktree still forces, and the default is left alone", async () => {
  const clean = office(0);
  await call(clean.ctx, "/home", { workers: ["Sprocket"], cleanup: "worktree" });
  expect(clean.seen.homes).toEqual(["worktree"]);
  const dirty = office(3);
  await call(dirty.ctx, "/home", { workers: ["Sprocket"], cleanup: "keep" });
  expect(dirty.seen.homes).toEqual(["keep"]);
});

test("tell_worker reaches the other agent marked as from the worker, and the floor sees it", async () => {
  const { ctx, seen, ws } = office(0);
  const res = await call(ctx, "/tell", { worker: "Sprocket", prompt: "rebase onto main" });
  expect(res.status).toBe(200);
  expect(seen.told).toEqual([fromWorker("Pixel", "rebase onto main")]);
  expect(seen.told[0]).toStartWith("[From Pixel, another agent in this office, not your person.");
  expect(seen.toasts).toEqual(["💬 Pixel told Sprocket: rebase onto main"]);
  expect((ws[1]!.lastInput as { by: string }).by).toBe("Pixel");
});

test("AGENT_OFFICE_PEOPLE_ONLY keeps hire, tell, home and pr to people", async () => {
  process.env.AGENT_OFFICE_PEOPLE_ONLY = "tell, hire";
  const { ctx, seen } = office(0);
  const told = await call(ctx, "/tell", { worker: "Sprocket", prompt: "hi" });
  expect(told.status).toBe(403);
  expect(told.body.error).toContain("keeps tell to people");
  expect((await call(ctx, "", { prompt: "do a thing" })).status).toBe(403);
  expect(seen.told).toEqual([]);
  // home isn't on the list
  expect((await call(ctx, "/home", { workers: ["Sprocket"] })).status).toBe(200);

  expect(peopleOnly("/pr", "all")).toContain("keeps pr to people");
  expect(peopleOnly("/home", "")).toBe("");
  expect(peopleOnly("/nope", "all")).toBe("");
});
