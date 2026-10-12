import { test, expect } from "bun:test";
import { adapt, lowPriorityCommand, machineLoad, scheduler, type Load } from "../src/priority.ts";

const BUDGET = { cpu: 0.6, memory: 0.5 };

/** A job that runs until you call its release. */
function gate() {
  let release!: () => void;
  const done = new Promise<void>((r) => (release = r));
  return { fn: () => done, release };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test("adapt: a blip does nothing, a sustained spike halves, a quiet stretch ramps back a slot at a time", () => {
  let s = { limit: 4, hot: 0, cool: 0 };
  const hot: Load = { cpu: 0.9, memory: 0.2 }, mid: Load = { cpu: 0.55, memory: 0.2 }, quiet: Load = { cpu: 0.1, memory: 0.1 };
  s = adapt(s, hot, BUDGET, 4, 3); s = adapt(s, hot, BUDGET, 4, 3); s = adapt(s, mid, BUDGET, 4, 3);
  s = adapt(s, hot, BUDGET, 4, 3);
  expect(s.limit).toBe(4);                      // two hot samples, a break, one more: a blip
  s = adapt(s, hot, BUDGET, 4, 3); s = adapt(s, hot, BUDGET, 4, 3);
  expect(s.limit).toBe(2);
  for (let i = 0; i < 6; i++) s = adapt(s, { cpu: 0.2, memory: 0.7 }, BUDGET, 4, 3);
  expect(s.limit).toBe(0);                      // memory over budget counts too, down to nothing
  for (let i = 0; i < 3; i++) s = adapt(s, quiet, BUDGET, 4, 3);
  expect(s.limit).toBe(1);
  for (let i = 0; i < 30; i++) s = adapt(s, quiet, BUDGET, 4, 3);
  expect(s.limit).toBe(4);                      // never past the slots
});

test("scheduler: slots are the CPU budget less the reserve, capped by max", () => {
  expect(scheduler({ cores: 10, everyMs: 0 }).stats().slots).toBe(5);
  expect(scheduler({ cores: 8, everyMs: 0, persona: "power-user" }).stats().slots).toBe(6);
  expect(scheduler({ cores: 10, everyMs: 0, max: 2 }).stats().slots).toBe(2);
  expect(scheduler({ cores: 2, everyMs: 0, persona: "background-beatdown" }).stats().slots).toBe(1);
});

test("scheduler: background work waits for a slot, normal before low; realtime and high never wait", async () => {
  const s = scheduler({ cores: 4, budget: { cpu: 1, reserve: 2 }, everyMs: 0 });   // 2 slots
  const order: string[] = [];
  const a = gate(), b = gate();
  void s.run("low", a.fn); void s.run("low", b.fn);
  const low = s.run("low", () => order.push("low"));
  const normal = s.run("normal", () => order.push("normal"));
  await s.run("realtime", () => order.push("realtime"));
  await s.run("high", () => order.push("high"));
  expect(s.stats().queued).toEqual({ normal: 1, low: 1 });
  a.release(); await settle(); b.release();
  await Promise.all([low, normal]);
  expect(order).toEqual(["realtime", "high", "normal", "low"]);
});

test("scheduler: a sustained spike stops new low work, normal still runs, quiet lets it back", async () => {
  let load: Load = { cpu: 0.9, memory: 0.1 };
  const lines: string[] = [];
  const s = scheduler({ cores: 4, budget: { cpu: 0.75, reserve: 0 }, everyMs: 0, window: 2, sample: () => load, log: (l) => lines.push(l) });  // 3 slots
  for (let i = 0; i < 4; i++) s.tick();        // 3 -> 1 -> 0
  expect(s.stats().lowLimit).toBe(0);
  let ran = false;
  const low = s.run("low", () => { ran = true; });
  await s.run("normal", () => {});
  await settle();
  expect(ran).toBe(false);
  load = { cpu: 0.1, memory: 0.1 };
  s.tick(); s.tick();
  await low;
  expect(ran).toBe(true);
  expect(lines.at(-1)).toContain("low 0 -> 1 of 3");
});

test("scheduler: a job starts only if its memory fits what's left of the budget", async () => {
  const s = scheduler({ cores: 16, totalMb: 1000, budget: { memory: 0.5 }, everyMs: 0 });   // 500 MB
  const big = gate();
  void s.run("low", big.fn, { memMb: 400 });
  let small = false, tooBig = false;
  const a = s.run("low", () => { small = true; }, { memMb: 100 });
  const b = s.run("low", () => { tooBig = true; }, { memMb: 200 });
  await a; await settle();
  expect([small, tooBig]).toEqual([true, false]);
  expect(s.stats().memMb.used).toBe(400);
  big.release(); await b;
  expect(tooBig).toBe(true);
  expect(s.stats().memMb.used).toBe(0);
  // bigger than the whole budget: runs once nothing else is
  expect(await s.run("low", () => "alone", { memMb: 9999 })).toBe("alone");
});

test("scheduler: a failed job frees its slot and rejects", async () => {
  const s = scheduler({ cores: 2, budget: { cpu: 1, reserve: 1 }, everyMs: 0 });
  await expect(s.run("low", () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(await s.run("low", () => 1)).toBe(1);
});

test("lowPriorityCommand: taskpolicy on macOS, nice on Linux", () => {
  expect(lowPriorityCommand(["pnpm", "install"], "darwin")).toEqual(["taskpolicy", "-b", "pnpm", "install"]);
  expect(lowPriorityCommand(["pnpm", "install"], "linux")).toEqual(["nice", "-n", "19", "pnpm", "install"]);
  expect(lowPriorityCommand(["pnpm", "install"], "win32")).toEqual(["pnpm", "install"]);
});

test("machineLoad: fractions between 0 and 1", () => {
  machineLoad();
  const l = machineLoad();
  for (const v of [l.cpu, l.memory]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
});

test("hostScheduler: one per process, its persona from RB_PERSONA", async () => {
  const run = (persona: string) => {
    const r = Bun.spawnSync(["bun", "-e", `import { hostScheduler } from "./src/priority.ts"; const s = hostScheduler(); console.log(JSON.stringify({ same: s === hostScheduler(), cpu: s.budget.cpu }))`], { env: { ...process.env, RB_PERSONA: persona }, cwd: import.meta.dir + "/.." });
    return { out: JSON.parse(r.stdout.toString()), err: r.stderr.toString() };
  };
  expect(run("background-burner").out).toEqual({ same: true, cpu: 0.95 });
  const odd = run("turbo");
  expect(odd.out.cpu).toBe(0.6);
  expect(odd.err).toContain("RB_PERSONA=turbo");
});
