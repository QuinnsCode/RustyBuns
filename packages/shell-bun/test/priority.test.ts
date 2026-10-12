import { test, expect } from "bun:test";
import { Effect } from "effect";
import { adapt, JobStopped, lowPriorityCommand, machineLoad, memoryCapCommand, processTreeMb, scheduler, treeMb, type Load } from "../src/priority.ts";

const BUDGET = { cpu: 0.6, memory: 0.5 };

/** A job that runs until you call its release. */
function gate() {
  let release!: () => void;
  const done = new Promise<void>((r) => (release = r));
  return { fn: () => done, release };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
/** The JobStopped a job rejected with. */
const stopped = (p: Promise<unknown>) => p.then(() => { throw new Error("not stopped"); }, (e: JobStopped) => e);

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

test("scheduler: a job past its timeout is stopped, its signal aborts and its slot frees", async () => {
  const s = scheduler({ cores: 1, budget: { cpu: 1, reserve: 0 }, everyMs: 0 });   // 1 slot
  let signal!: AbortSignal;
  const hung = s.run("low", (job) => { signal = job.signal; return new Promise(() => {}); }, { timeoutMs: 20 });
  const next = s.run("low", () => "next");
  expect(s.stats().queued.low).toBe(1);
  const err = await stopped(hung);
  expect(err).toBeInstanceOf(JobStopped);
  expect(err.reason).toBe("timeout");
  expect(signal.aborted).toBe(true);
  expect(await next).toBe("next");
  expect(s.stats().running.low).toBe(0);
});

test("scheduler: a tracked job past its maxMb is stopped; over the budget, the newest is put out and requeued", async () => {
  const sizes = new Map<number, number>();
  const lines: string[] = [];
  const s = scheduler({ cores: 16, totalMb: 1000, budget: { memory: 0.5 }, everyMs: 0, measure: (pids) => new Map(pids.map((p) => [p, sizes.get(p) ?? 0])), log: (l) => lines.push(l) });

  // its own ceiling: stopped, not requeued
  const greedy = s.run("low", (job) => { job.track(1); return new Promise(() => {}); }, { maxMb: 100, requeues: 3 });
  sizes.set(1, 150); s.tick();
  expect((await stopped(greedy)).reason).toBe("memory");

  // three jobs, each declared at 100 MB, grow to 200: 600 of 500. The newest goes back in the queue at its
  // measured size, and starts again once the oldest is done.
  const gates = [gate(), gate(), gate()];
  let starts = 0;
  const jobs = gates.map((g, i) => s.run("low", (job) => { starts++; job.track(10 + i); return g.fn(); }, { memMb: 100, requeues: 1 }));
  for (const i of [10, 11, 12]) sizes.set(i, 200);
  s.tick();
  expect(s.stats().running.low).toBe(2);
  expect(s.stats().queued.low).toBe(1);
  expect(s.stats().memMb.used).toBe(400);
  expect(lines.at(-1)).toContain("put out a low job at 200 MB");
  gates[0]!.release(); await jobs[0];
  sizes.set(12, 0);
  await settle();
  expect(s.stats().queued.low).toBe(0);                 // 200 + 200 fits: it ran again
  expect(starts).toBe(4);
  gates[1]!.release(); gates[2]!.release();
  await Promise.all(jobs);
});

test("scheduler: out of requeues, a job put out rejects", async () => {
  const s = scheduler({ cores: 16, totalMb: 1000, budget: { memory: 0.5 }, everyMs: 0, measure: (pids) => new Map(pids.map((p) => [p, 300])) });
  const first = gate();
  void s.run("low", (job) => { job.track(1); return first.fn(); });
  const second = s.run("low", (job) => { job.track(2); return new Promise(() => {}); });
  s.tick();
  expect((await stopped(second)).reason).toBe("evicted");
  first.release();
});

test("checkpoint: a low job gives its slot to waiting normal work and takes it back after", async () => {
  const s = scheduler({ cores: 1, budget: { cpu: 1, reserve: 0 }, everyMs: 0 });   // 1 slot
  const order: string[] = [];
  const step = gate();
  const low = s.run("low", async (job) => {
    order.push("low 1");
    await job.checkpoint();                       // nothing waits: runs straight on
    await step.fn();
    await job.checkpoint();
    order.push("low 2");
  });
  const normal = s.run("normal", () => { order.push("normal"); });
  await settle();
  expect(order).toEqual(["low 1"]);
  step.release();
  await Promise.all([low, normal]);
  expect(order).toEqual(["low 1", "normal", "low 2"]);
  expect(s.stats()).toMatchObject({ running: { low: 0, normal: 0 }, queued: { low: 0 }, parked: 0 });
});

test("checkpoint: a low job steps aside when the sampler cuts low below what's running", async () => {
  const load: Load = { cpu: 0.1, memory: 0.9 };    // memory over the budget: CPU's is the whole machine here
  const s = scheduler({ cores: 2, budget: { cpu: 1, reserve: 0 }, everyMs: 0, window: 1, sample: () => load });   // 2 slots
  const a = gate(), b = gate();
  const pass = (g: ReturnType<typeof gate>) => async (job: { checkpoint(): Promise<void> }) => { await g.fn(); await job.checkpoint(); return "done"; };
  const ja = s.run("low", pass(a)), jb = s.run("low", pass(b));
  s.tick();                                       // 2 -> 1
  a.release(); await settle();
  expect(s.stats()).toMatchObject({ running: { low: 1 }, parked: 1, queued: { low: 0 } });
  b.release(); await jb;                          // 1 of 1: b goes on, and its slot passes to a
  expect(await ja).toBe("done");
});

test("checkpoint: a stopped job throws there, parked or not, and holds no slot", async () => {
  const s = scheduler({ cores: 1, budget: { cpu: 1, reserve: 0 }, everyMs: 0 });
  let steps = 0, threw: unknown;
  const spinning = s.run("low", async (job) => {
    try { for (;;) { steps++; await job.checkpoint(); await new Promise((r) => setTimeout(r, 1)); } } catch (e) { threw = e; }
  }, { timeoutMs: 20 });
  expect((await stopped(spinning)).reason).toBe("timeout");
  await new Promise((r) => setTimeout(r, 5));
  expect(threw).toBeInstanceOf(JobStopped);
  const after = steps;
  await new Promise((r) => setTimeout(r, 10));
  expect(steps).toBe(after);                      // it really stopped

  // parked behind a normal job, then stopped while waiting (past its maxMb)
  const sizes = new Map<number, number>();
  const m = scheduler({ cores: 1, budget: { cpu: 1, reserve: 0 }, everyMs: 0, measure: (pids) => new Map(pids.map((p) => [p, sizes.get(p) ?? 0])) });
  const step = gate(), hang = gate();
  let parkedThrew: unknown;
  const low = m.run("low", async (job) => { job.track(1); await step.fn(); await job.checkpoint().catch((e) => { parkedThrew = e; throw e; }); }, { maxMb: 100 });
  const normal = m.run("normal", hang.fn);
  step.release(); await settle();
  expect(m.stats()).toMatchObject({ running: { normal: 1, low: 0 }, parked: 1 });
  sizes.set(1, 150); m.tick();
  expect((await stopped(low)).reason).toBe("memory");
  await settle();
  expect(parkedThrew).toBeInstanceOf(JobStopped);
  expect(m.stats()).toMatchObject({ running: { normal: 1, low: 0 }, parked: 0, queued: { low: 0 } });
  hang.release(); await normal;
  expect(m.stats().running).toMatchObject({ normal: 0, low: 0 });
});

test("checkpoint: parked time doesn't count toward timeoutMs", async () => {
  const s = scheduler({ cores: 1, budget: { cpu: 1, reserve: 0 }, everyMs: 0 });
  const step = gate(), hang = gate();
  const low = s.run("low", async (job) => { await step.fn(); await job.checkpoint(); return "done"; }, { timeoutMs: 40 });
  const normal = s.run("normal", hang.fn);
  step.release(); await settle();
  expect(s.stats().parked).toBe(1);
  await new Promise((r) => setTimeout(r, 80));     // twice its timeout, parked the whole time
  hang.release(); await normal;
  expect(await low).toBe("done");
});

test("checkpoint(release): over the memory budget a job lets memory go, is counted at its new size, and comes back when that fits", async () => {
  const sizes = new Map<number, number>([[1, 0]]);
  const lines: string[] = [];
  const s = scheduler({ cores: 16, totalMb: 1000, budget: { memory: 0.5 }, everyMs: 0, measure: (pids) => new Map(pids.map((p) => [p, sizes.get(p) ?? 0])), log: (l) => lines.push(l) });   // 500 MB
  const oldest = gate(), step = gate(), again = gate();
  let calls = 0;
  void s.run("low", (job) => { job.track(1); return oldest.fn(); }, { memMb: 100 });
  const cache = s.run("normal", async (job) => {
    await job.checkpoint(() => { calls++; return 10; });     // under the budget: the hook isn't called
    await step.fn();
    await job.checkpoint(() => { calls++; return 50; });     // over it: 300 -> 50
    await again.fn();
    return "cache";
  }, { memMb: 300 });
  await settle();
  expect(calls).toBe(0);
  sizes.set(1, 300); s.tick();                    // the oldest grows: 600 of 500, and it's the one kept going
  expect(s.stats().memMb.used).toBe(600);
  step.release(); await settle();
  expect(calls).toBe(1);
  expect(s.stats()).toMatchObject({ parked: 1, running: { normal: 0 }, memMb: { used: 350 } });
  expect(lines.some((l) => l.includes("let 250 MB go"))).toBe(true);
  s.tick();
  expect(s.stats().parked).toBe(1);               // 350 + the 250 it will take again doesn't fit
  sizes.set(1, 100); s.tick();                    // 150 + 250 does
  expect(s.stats()).toMatchObject({ parked: 0, running: { normal: 1 }, memMb: { used: 400 } });
  again.release();
  expect(await cache).toBe("cache");
  oldest.release();
});

test("pause: over the memory budget a job with pause has its child stopped, not put out, and goes on once it fits", async () => {
  if (process.platform === "win32") return;
  const sizes = new Map<number, number>();
  const s = scheduler({ cores: 16, totalMb: 1000, budget: { memory: 0.5 }, everyMs: 0, measure: (pids) => new Map(pids.map((p) => [p, sizes.get(p) ?? 0])) });
  const state = (pid: number) => Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]).stdout.toString().trim();
  const first = gate();
  void s.run("low", (job) => { job.track(1); return first.fn(); });
  let pid = 0;
  const paused = s.run("low", async (job) => {
    const p = Bun.spawn(["sleep", "0.5"]);
    pid = p.pid; job.track(p.pid);
    return p.exited;
  }, { pause: true, timeoutMs: 300 });
  await settle();
  sizes.set(1, 300); sizes.set(pid, 300); s.tick();
  expect(s.stats()).toMatchObject({ paused: 1, running: { low: 1 }, queued: { low: 0 } });
  expect(state(pid)).toStartWith("T");
  await new Promise((r) => setTimeout(r, 400));   // past its timeout, paused: the clock stopped
  expect(s.stats().paused).toBe(1);
  sizes.set(1, 100); s.tick();                    // 400 of 500: it goes on
  expect(s.stats()).toMatchObject({ paused: 0, running: { low: 2 } });
  expect(state(pid)).not.toStartWith("T");
  expect(await paused).toBe(0);
  first.release();
});

test("pause: a paused job that's stopped is let go (SIGCONT) so its kill lands", async () => {
  if (process.platform === "win32") return;
  let childMb = 0;
  const s = scheduler({ cores: 16, totalMb: 1000, budget: { memory: 0.5 }, everyMs: 0, measure: (pids) => new Map(pids.map((p) => [p, p === 1 ? 300 : childMb])) });
  const first = gate();
  void s.run("low", (job) => { job.track(1); return first.fn(); });
  const child = s.spawn("low", ["sleep", "30"], { pause: true, maxMb: 400, graceMs: 50 });
  await settle();
  childMb = 300; s.tick();
  expect(s.stats().paused).toBe(1);
  childMb = 500; s.tick();                        // past its own maxMb while paused
  expect((await stopped(child)).reason).toBe("memory");
  expect(s.stats()).toMatchObject({ paused: 0, running: { low: 1 }, queued: { low: 0 } });
  first.release();
});

test("runEffect: a stop interrupts the fiber and runs its finalizers; checkpoint yields like run's", async () => {
  const s = scheduler({ cores: 1, budget: { cpu: 1, reserve: 0 }, everyMs: 0 });
  let released = false;
  const hung = s.runEffect("low", () => Effect.acquireRelease(Effect.succeed(1), () => Effect.sync(() => { released = true; })).pipe(
    Effect.andThen(Effect.never), Effect.scoped), { timeoutMs: 20 });
  expect((await stopped(hung)).reason).toBe("timeout");
  await settle();
  expect(released).toBe(true);

  const order: string[] = [];
  const step = gate();
  const low = s.runEffect("low", (job) => Effect.gen(function* () {
    order.push("low 1");
    yield* Effect.promise(step.fn);
    yield* job.checkpoint;
    order.push("low 2");
    yield* job.checkpointWith(Effect.sync(() => { order.push("released"); return 0; }));   // under the budget: not called
    return 7;
  }));
  const normal = s.run("normal", () => { order.push("normal"); });
  await settle();
  step.release();
  expect(await low).toBe(7);
  await normal;
  expect(order).toEqual(["low 1", "normal", "low 2"]);
});

test("scheduler.spawn: runs the command in a slot; a timeout kills the child", async () => {
  const s = scheduler({ cores: 1, budget: { cpu: 1, reserve: 0 }, everyMs: 0 });
  expect((await s.spawn("normal", ["sh", "-c", "exit 3"])).exitCode).toBe(3);
  const t = Date.now();
  const err = await stopped(s.spawn("low", ["sleep", "30"], { timeoutMs: 50, graceMs: 100 }));
  expect(err.reason).toBe("timeout");
  expect(Date.now() - t).toBeLessThan(5000);
  expect(s.stats().running.low).toBe(0);
});

const BUSY = new URL("./fixtures/busy.worker.ts", import.meta.url);
type Busy = { seen: number; echo: unknown };

test("scheduler.worker: a job on a worker thread; with warm, the next job reuses it and it counts against the budget", async () => {
  const cold = scheduler({ cores: 4, everyMs: 0 });
  expect(await cold.worker<Busy>("low", BUSY, "a")).toEqual({ seen: 1, echo: "a" });
  expect(await cold.worker<Busy>("low", BUSY, "b")).toEqual({ seen: 1, echo: "b" });   // no pool: a fresh thread each time
  expect(cold.stats().warm).toBe(0);

  const s = scheduler({ cores: 4, everyMs: 0, warm: 1, workerMb: 40 });
  await s.worker("low", BUSY, 1);
  expect(await s.worker<Busy>("normal", BUSY, 2)).toEqual({ seen: 2, echo: 2 });
  expect(s.stats().warm).toBe(1);
  expect(s.stats().memMb.used).toBe(40);
  s.stop();
  expect(s.stats().warm).toBe(0);
});

test("scheduler.worker: a timeout terminates the thread and frees the slot; a throw rejects and isn't pooled", async () => {
  const s = scheduler({ cores: 1, budget: { cpu: 1, reserve: 0 }, everyMs: 0, warm: 1 });   // 1 slot
  const spin = s.worker("low", BUSY, "spin", { timeoutMs: 100 });
  const next = s.worker("low", BUSY, "next");
  expect((await stopped(spin)).reason).toBe("timeout");
  expect(await next).toEqual({ seen: 1, echo: "next" });
  expect(s.stats().warm).toBe(1);
  await expect(s.worker("low", BUSY, "throw")).rejects.toThrow("thrown in the worker");
  expect(s.stats().warm).toBe(0);
  expect(await s.worker<Busy>("low", BUSY, "after")).toEqual({ seen: 1, echo: "after" });
  s.stop();
});

test("scheduler.worker: the pool shrinks when the sampler backs off, and gives its memory to a job that needs it", async () => {
  let load: Load = { cpu: 0.1, memory: 0.1 };
  const s = scheduler({ cores: 4, budget: { cpu: 1, reserve: 0 }, totalMb: 1000, everyMs: 0, window: 1, warm: 3, workerMb: 100, sample: () => load });   // 4 slots, 500 MB
  await Promise.all([1, 2, 3].map((n) => s.worker("low", BUSY, n)));
  expect(s.stats().warm).toBe(3);
  load = { cpu: 0.1, memory: 0.9 };
  s.tick();                                             // low 4 -> 2
  expect(s.stats().warm).toBe(2);
  expect(await s.run("low", () => s.stats().warm, { memMb: 400 })).toBe(1);   // 200 idle + 400 > 500: one let go
  s.stop();
});

test("treeMb: a process and its descendants, from ps", () => {
  const ps = ["  1     0  1024", " 10     1  2048", " 11    10  1024", " 12    11   512", " 20     1  4096", ""].join("\n");
  expect(treeMb(ps, [10, 20, 99])).toEqual(new Map([[10, 3.5], [20, 4], [99, 0]]));
  expect(processTreeMb([process.pid]).get(process.pid) ?? 1).toBeGreaterThan(0);
});

test("memoryCapCommand: a systemd scope with MemoryMax, --user unless root", () => {
  expect(memoryCapCommand(["bun", "x.ts"], 512, false)).toEqual(["systemd-run", "--user", "--scope", "--quiet", "-p", "MemoryMax=512M", "-p", "MemorySwapMax=0", "--", "bun", "x.ts"]);
  expect(memoryCapCommand(["bun"], 100.5, true).slice(0, 5)).toEqual(["systemd-run", "--scope", "--quiet", "-p", "MemoryMax=101M"]);
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
