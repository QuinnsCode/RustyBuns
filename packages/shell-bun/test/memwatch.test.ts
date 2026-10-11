import { test, expect } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memWatch, slope } from "../src/memwatch.ts";

const MB = 2 ** 20, MIN = 60_000;

/** A watch on a fake clock, its RSS climbing `perTick` MB a sample. */
function fake(perTick: number, opts: { maxMb?: number; snapshotDir?: string; beforeRestart?: () => Promise<unknown> } = {}) {
  let t = 0, rss = 100 * MB;
  const lines: string[] = [], exits: number[] = [];
  const w = memWatch({ ...opts, everyMs: 3_600_000, now: () => t, log: (l) => lines.push(l), exit: (c) => exits.push(c),
    sample: () => ({ rss, heap: rss / 2 }) });
  const step = () => { w.tick(); t += 5 * MIN; rss += perTick * MB; };
  return { w, step, lines, exits };
}

test("slope: least squares, null with too few points", () => {
  expect(slope([{ at: 0, rss: 0 }, { at: 1, rss: 1 }])).toBeNull();
  expect(slope([{ at: 0, rss: 0 }, { at: 1, rss: 2 }, { at: 2, rss: 4 }])).toBe(2);
});

test("memWatch: a steady climb reads as MB/h and hours to the ceiling", () => {
  const { w, step, lines } = fake(1, { maxMb: 200 });
  for (let i = 0; i < 6; i++) step();
  w.stop();
  const s = w.stats();
  expect(s.slopeMbPerHour).toBe(12);            // 1 MB every 5 minutes
  expect(s.rssMb).toBe(105);
  expect(s.hoursToMax).toBeCloseTo(95 / 12, 1);
  expect(lines.at(-1)).toContain("+12MB/h");
});

test("memWatch: flat memory, no ceiling, no prediction", () => {
  const { w, step } = fake(0);
  for (let i = 0; i < 4; i++) step();
  w.stop();
  expect(w.stats().slopeMbPerHour).toBe(0);
  expect(w.stats().hoursToMax).toBeNull();
  expect(w.stats().maxMb).toBeNull();
});

test("memWatch: over the ceiling it snapshots the heap once and exits 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-mem-"));
  const { w, step, exits, lines } = fake(50, { maxMb: 180, snapshotDir: dir });
  for (let i = 0; i < 4; i++) step();             // 100, 150, 200, 250
  w.stop();
  await Bun.sleep(200);
  expect(exits).toEqual([1]);
  expect(lines.some((l) => l.includes("over the 180MB ceiling"))).toBe(true);
  expect(readdirSync(dir).filter((f) => f.endsWith(".heapsnapshot"))).toHaveLength(1);
});

test("memWatch: onSample gets the stats after every sample", () => {
  const seen: number[] = [];
  const w = memWatch({ everyMs: 3_600_000, log: () => {}, sample: () => ({ rss: 50 * MB, heap: 10 * MB }), onSample: (s) => seen.push(s.rssMb) });
  w.tick(); w.tick();
  w.stop();
  expect(seen).toEqual([50, 50]);
});

test("memWatch: over the ceiling, beforeRestart runs first, and a failure still restarts", async () => {
  const order: string[] = [];
  const { w, step, exits, lines } = fake(50, { maxMb: 120, beforeRestart: async () => { order.push("prof"); throw new Error("busy"); } });
  for (let i = 0; i < 2; i++) step();
  w.stop();
  await Bun.sleep(20);
  expect(order).toEqual(["prof"]);
  expect(exits).toEqual([1]);
  expect(lines.some((l) => l.includes("before restart: busy"))).toBe(true);
});
