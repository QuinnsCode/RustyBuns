import { expect, test } from "bun:test";
import { linkSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scratchOf, settings, sizeOf, StorageGuard, storageGuard, type Deps, type Seat } from "../live/storage.ts";

const GB = 1024 ** 3;

function office(sizes: Record<string, number>, free = 100 * GB, vars: Record<string, string> = {}) {
  const seats: Seat[] = Object.keys(sizes).map((id) => ({ id, name: id.toUpperCase(), pid: 1, cwd: `/w/${id}` }));
  const alerts: string[] = [];
  const state = { free, sizes };
  const d: Deps = {
    seats: () => seats,
    sizeOf: async (s) => ({ bytes: state.sizes[s.id]!, top: [{ path: `/w/${s.id}/node_modules`, bytes: state.sizes[s.id]! }] }),
    free: () => state.free,
    alert: (t) => alerts.push(t),
    settings: () => settings(vars),
  };
  return { guard: new StorageGuard(d), alerts, state };
}

test("a worker over the cap is named once with the biggest directories, and again only after it was clearly under", async () => {
  const o = office({ a: 3 * GB, b: 9 * GB });
  await o.guard.look();
  await o.guard.look();
  expect(o.alerts).toHaveLength(1);
  expect(o.alerts[0]).toContain("B's sandbox is 9.0 GB, over the 8.0 GB cap");
  expect(o.alerts[0]).toContain("node_modules");
  o.state.sizes.b = 7.8 * GB; // hovering just under the line
  await o.guard.look();
  o.state.sizes.b = 5 * GB;
  await o.guard.look();
  o.state.sizes.b = 9 * GB;
  await o.guard.look();
  expect(o.alerts).toHaveLength(2);
});

test("a disk under the floor is said once; zero turns the cap and the floor off", async () => {
  const o = office({ a: GB, b: GB }, 10 * GB);
  await o.guard.look();
  await o.guard.look();
  expect(o.alerts).toHaveLength(1);
  expect(o.alerts[0]).toContain("Only 10.0 GB free");
  const off = office({ a: 50 * GB }, GB, { AGENT_OFFICE_SANDBOX_CAP_GB: "0", AGENT_OFFICE_DISK_FLOOR_GB: "0" });
  await off.guard.look();
  expect(off.alerts).toEqual([]);
});

const state = (pid: number) => Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]).stdout.toString().trim();

test("a full disk and a worker over the cap warn on the floor but never stop the worker's session", async () => {
  // its own process group, as a worker's terminal is
  const worker = Bun.spawn(["sh", "-c", "exec sleep 60"], { detached: true, stdout: "ignore" });
  const tree = mkdtempSync(path.join(tmpdir(), "rb-storage-seat-"));
  writeFileSync(path.join(tree, "f"), Buffer.alloc(64 << 10));
  const toasts: string[] = [];
  const floor = {
    id: "f1",
    ctx: { toast: (_: unknown, text: string) => void toasts.push(text) },
    workers: { owners: () => [{ workerId: "w1", pid: worker.pid, cwd: tree }], get: () => ({ name: "Byte" }) },
  };
  const guard = storageGuard(floor, tree, tree, { AGENT_OFFICE_DISK_FLOOR_GB: "100000", AGENT_OFFICE_SANDBOX_CAP_GB: "0.000001" });
  try {
    for (let i = 0; i < 100 && toasts.length < 2; i++) await Bun.sleep(50);
    expect(toasts.join("\n")).toContain("free on the disk");
    expect(toasts.join("\n")).toContain("Byte's sandbox");
    expect(state(worker.pid)).not.toStartWith("T");
  } finally {
    guard.stop();
    worker.kill("SIGKILL");
  }
});

test("a sandbox's size skips .git, counts a file hardlinked into its scratch once, and sees node_modules grow on the next look", async () => {
  const MB = 1 << 20;
  const tree = mkdtempSync(path.join(tmpdir(), "rb-storage-"));
  const scratch = mkdtempSync(path.join(tmpdir(), "rb-storage-scratch-"));
  mkdirSync(path.join(tree, ".git"));
  writeFileSync(path.join(tree, ".git", "big"), Buffer.alloc(8 * MB));
  mkdirSync(path.join(tree, "node_modules", "x"), { recursive: true });
  writeFileSync(path.join(tree, "node_modules", "x", "f"), Buffer.alloc(2 * MB));
  linkSync(path.join(tree, "node_modules", "x", "f"), path.join(scratch, "f"));
  const first = await sizeOf([tree, scratch, path.join(tree, "missing")]);
  expect(first.bytes).toBeGreaterThanOrEqual(2 * MB);
  expect(first.bytes).toBeLessThan(3 * MB);
  expect(first.top[0]).toEqual({ path: path.join(tree, "node_modules"), bytes: expect.any(Number) });

  writeFileSync(path.join(tree, "node_modules", "x", "g"), Buffer.alloc(4 * MB));
  expect((await sizeOf([tree, scratch])).bytes).toBeGreaterThan(first.bytes + 3 * MB);
});

test("a worker's scratch folder is named from its directory the way Claude Code does", () => {
  expect(scratchOf("/Users/q/agent-office/R/.agent-office/worktrees/nibble-1", 501, "/private/tmp"))
    .toBe("/private/tmp/claude-501/-Users-q-agent-office-R--agent-office-worktrees-nibble-1");
});
