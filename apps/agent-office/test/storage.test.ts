import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scratchOf, settings, Sizer, StorageGuard, type Deps, type Seat } from "../live/storage.ts";

const GB = 1024 ** 3;

function office(sizes: Record<string, number>, free = 100 * GB, vars: Record<string, string> = {}) {
  const seats: Seat[] = Object.keys(sizes).map((id) => ({ id, name: id.toUpperCase(), pid: 1, cwd: `/w/${id}` }));
  const log: string[] = [];
  const alerts: string[] = [];
  const state = { free, sizes, saved: [] as string[] };
  const d: Deps = {
    seats: () => seats,
    sizeOf: async (s) => ({ bytes: state.sizes[s.id]!, top: [{ path: `/w/${s.id}/node_modules`, bytes: state.sizes[s.id]! }] }),
    free: () => state.free,
    pause: (s) => log.push(`stop ${s.id}`),
    resume: (s) => log.push(`go ${s.id}`),
    alert: (t) => alerts.push(t),
    settings: () => settings(vars),
    load: () => [],
    save: (ids) => (state.saved = ids),
  };
  return { guard: new StorageGuard(d), log, alerts, state };
}

test("a worker over the cap is paused once with the biggest directories, and resumes when it is under", async () => {
  const o = office({ a: 3 * GB, b: 9 * GB });
  await o.guard.look();
  await o.guard.look();
  expect(o.log).toEqual(["stop b"]);
  expect(o.alerts).toHaveLength(1);
  expect(o.alerts[0]).toContain("B's sandbox is 9.0 GB, over the 8.0 GB cap");
  expect(o.alerts[0]).toContain("node_modules");
  expect(o.state.saved).toEqual(["b"]);

  // hovering just under the line is not enough; clearly under is
  o.state.sizes.b = 7.8 * GB;
  await o.guard.look();
  expect(o.log).toEqual(["stop b"]);
  o.state.sizes.b = 5 * GB;
  await o.guard.look();
  expect(o.log).toEqual(["stop b", "go b"]);
  expect(o.state.saved).toEqual([]);
});

test("raising the cap resumes a paused worker", async () => {
  const vars: Record<string, string> = {};
  const o = office({ a: 9 * GB }, 100 * GB, vars);
  await o.guard.look();
  vars.AGENT_OFFICE_SANDBOX_CAP_GB = "12";
  await o.guard.look();
  expect(o.log).toEqual(["stop a", "go a"]);
});

test("under the volume floor every worker pauses with one alert, and all resume once there is room", async () => {
  const o = office({ a: GB, b: GB }, 10 * GB);
  await o.guard.look();
  await o.guard.look();
  expect(o.log).toEqual(["stop a", "stop b"]);
  expect(o.alerts).toHaveLength(1);
  o.state.free = 50 * GB;
  await o.guard.look();
  expect(o.log.slice(2).sort()).toEqual(["go a", "go b"]);
});

test("zero turns the cap and the floor off", async () => {
  const o = office({ a: 50 * GB }, GB, { AGENT_OFFICE_SANDBOX_CAP_GB: "0", AGENT_OFFICE_DISK_FLOOR_GB: "0" });
  await o.guard.look();
  expect(o.log).toEqual([]);
});

test("sizing skips .git, counts a hardlink once, and keeps node_modules for a while", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "rb-storage-"));
  mkdirSync(path.join(root, ".git"));
  writeFileSync(path.join(root, ".git", "big"), Buffer.alloc(1 << 20));
  mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "x", "f"), Buffer.alloc(1 << 20));
  let now = 0;
  const sizer = new Sizer(() => now);
  const first = await sizer.size(root);
  expect(first.bytes).toBeGreaterThanOrEqual(1 << 20);
  expect(first.bytes).toBeLessThan(2 << 20);
  expect(first.top[0]!.path).toBe(path.join(root, "node_modules"));

  writeFileSync(path.join(root, "node_modules", "x", "g"), Buffer.alloc(4 << 20));
  expect((await sizer.size(root)).bytes).toBe(first.bytes);
  now += 20 * 60_000;
  expect((await sizer.size(root)).bytes).toBeGreaterThan(first.bytes + (3 << 20));
});

test("a worker's scratch folder is named from its directory the way Claude Code does", () => {
  expect(scratchOf("/Users/q/agent-office/R/.agent-office/worktrees/nibble-1", 501, "/private/tmp"))
    .toBe("/private/tmp/claude-501/-Users-q-agent-office-R--agent-office-worktrees-nibble-1");
});
