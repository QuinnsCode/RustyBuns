// Priority classes for work on a host (#955): realtime, high, normal, low. One JS thread is one core,
// so the heavy work runs elsewhere (child processes, workers) and this decides how much of it runs at
// once, under a budget the user sets ("no more than 60% of CPU, 50% of memory").
//
// - realtime and high run at once. The scheduler never queues, throttles or demotes them, and keeps
//   `reserve` cores free of background work for them.
// - normal and low share `slots`: the cores the CPU budget allows, less the reserve.
// - low also has an adaptive limit. A sampler reads the machine's CPU and memory, and a spike held for
//   `window` samples (not a blip) halves it, down to 0: new low work waits. As many quiet samples
//   in a row ramp it back up a slot at a time.
// - a job can say how much memory it usually takes (`memMb`). It starts only if that fits what the
//   memory budget has left after the jobs already running.
// - a job that runs child processes tracks them (`spawn` does it for you), and each sample measures
//   how big they really are. One past its own `maxMb` is stopped; while the background work is over
//   the memory budget the newest is put out and, if it may, queued again sized as measured (#1028).
//   On Linux `maxMb` is also a hard cap, a cgroup through systemd-run; macOS stays watch-and-act.
// - `timeoutMs` stops a job that hangs, so it can't hold a slot for good. A stop aborts the job's
//   signal and frees its slot at once; plain JS that ignores the signal runs on, outside the budget.
// - a long job calls `checkpoint()` now and then (#1048). There a stopped job throws its JobStopped, and
//   a low job gives its slot back while normal work waits for one, or while the sampler has cut low
//   below what is running. It waits at the front of its class for a slot again, still holding its memory.
//   `checkpoint(release)` can let memory go first (drop caches, spill to disk): the hook says the job's new
//   size, the scheduler counts it at that, and a job with one also steps aside while background work is
//   over the memory budget, coming back once what it let go fits again (#1065).
// - a job with `pause` (and child processes it tracks) is paused rather than put out when it pushes the
//   background work over the memory budget: its process trees get SIGSTOP, it gives its slot back, and
//   SIGCONT once it fits again. A paused child stops growing and the kernel can page it out; each sample
//   counts it at what it measures. Not on Windows, which has no SIGSTOP: there it is put out as before.
// - parked or paused, a job's `timeoutMs` clock stops: the timeout is for time spent holding a slot.
// - `runEffect` runs an Effect as the job, in a fiber a stop interrupts: wherever it is, its finalizers
//   run (an acquireRelease child is killed) and nothing of it runs on outside the budget. Checkpoints are
//   Effects underneath, so `checkpointWith(release)` runs its release in that fiber too (#1079).
// - CPU-heavy JS runs on a worker thread through the same slots (`worker`), and a stop terminates the
//   thread, so it is the one kind of JS job a stop really interrupts. Up to `warm` finished workers are
//   kept loaded, so the next job for the same module skips the startup (#1047). An idle one counts
//   `workerMb` against the memory budget, the pool shrinks with the low limit when the sampler backs
//   off, and idle workers are let go first when a job needs their memory.
//
// Child processes of low work get OS background priority too (`lowPriorityCommand`), so the kernel
// prefers everything else even while they run.
//
// A host has one scheduler (`hostScheduler()`), so its crons and queue consumers share one budget.
// They run as low unless they say otherwise; `RB_PERSONA` at launch picks the budget (#1018).

import { availableParallelism, cpus, freemem, totalmem } from "node:os";
import { Effect } from "effect";

export type Priority = "realtime" | "high" | "normal" | "low";

export interface Budget {
  /** Fraction of the cores background (normal + low) work may use. */
  cpu: number;
  /** Fraction of the machine's memory: background work admits against it, and the sampler backs off over it. */
  memory: number;
  /** Cores held back from background work for realtime and high. */
  reserve: number;
}

/** Ready-made budgets. `balanced` is the owner's 60% CPU / 50% memory. */
export const PERSONAS = {
  balanced: { cpu: 0.6, memory: 0.5, reserve: 1 },
  /** Runs wide; still backs off, late. */
  "power-user": { cpu: 0.9, memory: 0.75, reserve: 1 },
  /** Background work kept small and pushed out of the way: a laptop you are using. */
  "background-beatdown": { cpu: 0.25, memory: 0.25, reserve: 2 },
  /** An idle box burning through a sweep: all but a core, backing off only when the machine is near full. */
  "background-burner": { cpu: 0.95, memory: 0.8, reserve: 1 },
} satisfies Record<string, Budget>;
export type Persona = keyof typeof PERSONAS;

/** How busy the machine is, each 0..1. */
export interface Load { cpu: number; memory: number }

export interface SchedulerOptions {
  persona?: Persona;
  /** Overrides on the persona's budget. */
  budget?: Partial<Budget>;
  /** @default os.availableParallelism() */
  cores?: number;
  /** @default os.totalmem() in MB */
  totalMb?: number;
  /** Most background jobs at once, whatever the budget allows (a harness's --jobs). */
  max?: number;
  /** Reads the machine's load. @default machineLoad() */
  sample?: () => Load;
  /** @default 5 seconds; 0 samples only when you call tick() */
  everyMs?: number;
  /** Samples in a row that count as sustained, both to back off and to ramp up. @default 6 (30s at 5s) */
  window?: number;
  /** How big each tracked process tree is, in MB. @default processTreeMb (ps) */
  measure?: (pids: number[]) => Map<number, number>;
  /** Finished workers kept loaded for the next job on the same module. @default 0 */
  warm?: number;
  /** What a worker thread counts against the memory budget, idle or running, when its job doesn't say. @default 30 */
  workerMb?: number;
  log?: (line: string) => void;
}

export interface SchedulerStats {
  slots: number;
  lowLimit: number;
  running: Record<Priority, number>;
  queued: { normal: number; low: number };
  /** Jobs that gave their slot back at a checkpoint and wait for one again. */
  parked: number;
  /** Jobs whose processes were paused (SIGSTOP) over the memory budget, waiting for room to go on. */
  paused: number;
  memMb: { used: number; budget: number };
  /** Idle workers kept loaded. */
  warm: number;
  load: Load | null;
}

export interface Backoff { limit: number; hot: number; cool: number }

/** One sampler step for the low class's limit. Over the budget for `window` samples in a row halves
 *  it; under 80% of it for as many doubles back a slot at a time. A sample in between resets both runs. */
export function adapt(s: Backoff, load: Load, budget: Pick<Budget, "cpu" | "memory">, max: number, window: number): Backoff {
  const hot = load.cpu > budget.cpu || load.memory > budget.memory;
  const cool = load.cpu < budget.cpu * 0.8 && load.memory < budget.memory * 0.8;
  if (hot) return s.hot + 1 >= window ? { limit: Math.floor(s.limit / 2), hot: 0, cool: 0 } : { ...s, hot: s.hot + 1, cool: 0 };
  if (cool) return s.cool + 1 >= window ? { limit: Math.min(max, s.limit + 1), hot: 0, cool: 0 } : { ...s, hot: 0, cool: s.cool + 1 };
  return { ...s, hot: 0, cool: 0 };
}

let lastCpu: { idle: number; total: number } | null = null;
const cpuTimes = () => cpus().reduce((a, c) => { const t = c.times; return { idle: a.idle + t.idle, total: a.total + t.user + t.nice + t.sys + t.idle + t.irq }; }, { idle: 0, total: 0 });

/** The whole machine's CPU since the last call (0 the first time) and memory in use. On macOS free
 *  memory leaves out the reclaimable cache, so it reads near full; the kernel's own pressure level
 *  (kern.memorystatus_level, percent available) is the honest number there. */
export function machineLoad(): Load {
  const now = cpuTimes(), prev = lastCpu;
  lastCpu = now;
  const cpu = prev && now.total > prev.total ? 1 - (now.idle - prev.idle) / (now.total - prev.total) : 0;
  let memory = 1 - freemem() / totalmem();
  if (process.platform === "darwin") {
    const r = Bun.spawnSync(["sysctl", "-n", "kern.memorystatus_level"]);
    const free = Number(r.stdout.toString().trim());
    if (r.exitCode === 0 && free >= 0 && free <= 100) memory = 1 - free / 100;
  }
  return { cpu, memory };
}

/** `cmd` run at the OS's background priority: `taskpolicy -b` on macOS (throttled CPU and disk, the
 *  efficiency cores on Apple silicon), `nice -n 19` on Linux. Children inherit it. Elsewhere unchanged. */
export function lowPriorityCommand(cmd: string[], platform: string = process.platform): string[] {
  if (platform === "darwin") return ["taskpolicy", "-b", ...cmd];
  if (platform === "linux") return ["nice", "-n", "19", ...cmd];
  return cmd;
}

/** `cmd` under a hard memory cap: a transient systemd scope with MemoryMax (cgroup v2), so the kernel
 *  kills it past `mb` instead of the machine swapping. `--user` unless we are root. Linux only. */
export function memoryCapCommand(cmd: string[], mb: number, root: boolean): string[] {
  return ["systemd-run", ...(root ? [] : ["--user"]), "--scope", "--quiet", "-p", `MemoryMax=${Math.ceil(mb)}M`, "-p", "MemorySwapMax=0", "--", ...cmd];
}

let capWorks: boolean | undefined;
/** memoryCapCommand where it works (Linux with systemd, tried once per process); elsewhere `cmd` as is,
 *  and the scheduler's watch-and-act is the only cap. */
function hardCap(cmd: string[], mb: number): string[] {
  if (process.platform !== "linux") return cmd;
  const root = process.getuid?.() === 0;
  capWorks ??= Bun.which("systemd-run") !== null && Bun.spawnSync(memoryCapCommand(["true"], 64, root), { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  return capWorks ? memoryCapCommand(cmd, mb, root) : cmd;
}

/** Each of `pids`, with its descendants, in MB, from `ps -A -o pid=,ppid=,rss=` output. */
export function treeMb(ps: string, pids: number[]): Map<number, number> {
  const rss = new Map<number, number>(), kids = new Map<number, number[]>();
  for (const line of ps.split("\n")) {
    const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
    if (!pid || ppid === undefined || kb === undefined || Number.isNaN(kb)) continue;
    rss.set(pid, kb / 1024);
    (kids.get(ppid) ?? kids.set(ppid, []).get(ppid)!).push(pid);
  }
  const out = new Map<number, number>();
  for (const root of pids) {
    let mb = 0;
    for (const stack = [root], seen = new Set<number>(); stack.length;) {
      const p = stack.pop()!;
      if (seen.has(p)) continue;
      seen.add(p); mb += rss.get(p) ?? 0; stack.push(...kids.get(p) ?? []);
    }
    out.set(root, mb);
  }
  return out;
}

const ps = () => {
  try { const r = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,rss="]); return r.exitCode === 0 ? r.stdout.toString() : ""; } catch { return ""; }
};
/** How big each process tree really is, in MB. No `ps` (Windows): nothing measured. */
export const processTreeMb = (pids: number[]) => treeMb(ps(), pids);

/** Why the scheduler stopped a job: past its `timeoutMs`, past its own `maxMb`, or put out
 *  (and requeued while it has `requeues` left) to bring the background work back under the memory budget. */
export class JobStopped extends Error {
  constructor(readonly reason: "timeout" | "memory" | "evicted", message: string) { super(message); this.name = "JobStopped"; }
}

/** Lets memory go before a job parks (drop caches, spill to disk) and says the job's size after, in MB.
 *  Nothing returned: it let nothing go. */
export type Release = () => number | void | Promise<number | void>;

/** What a job is handed. `signal` aborts (with a JobStopped) when the scheduler stops it; the job should
 *  stop its work then. `track(pid)` counts a child process and its descendants against the memory budget.
 *  `checkpoint()` is a safe place to stop or step aside: it rejects with the JobStopped if the job was
 *  stopped, and for a low job that should make room it gives the slot back and resolves once it has one again.
 *  With a `release`, it runs that before stepping aside, and steps aside too while background work is over
 *  the memory budget. */
export interface JobContext { signal: AbortSignal; track(pid: number): void; checkpoint(release?: Release): Promise<void> }

/** What an Effect job is handed: the same, with `checkpoint` an Effect to yield* between steps, and
 *  `checkpointWith(release)` the one that lets memory go first. */
export interface EffectJobContext {
  signal: AbortSignal;
  track(pid: number): void;
  checkpoint: Effect.Effect<void>;
  checkpointWith(release: Effect.Effect<number | void>): Effect.Effect<void>;
}

export interface RunOptions {
  /** What the job usually takes, in MB. It starts only if that fits what the memory budget has left. */
  memMb?: number;
  /** Stop the job after this long: its signal aborts, its slot frees and the promise rejects. A job that
   *  ignores the signal runs on, but no longer holds the slot. */
  timeoutMs?: number;
  /** The most the job's tracked processes may take, in MB. Past it the job is stopped, not requeued. */
  maxMb?: number;
  /** Times the job may be put out for memory and queued again (at the front, sized as it was measured)
   *  before it rejects. Only for a job that can start over: `fn` runs again. @default 0 */
  requeues?: number;
  /** Over the memory budget, pause the job's tracked processes (SIGSTOP) instead of putting it out, and
   *  go on (SIGCONT) once it fits again. For a job that can't start over cheaply. Not on Windows. */
  pause?: boolean;
}

export interface SpawnOptions extends RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: "inherit" | "pipe" | "ignore";
  stderr?: "inherit" | "pipe" | "ignore";
  /** After SIGTERM, how long before SIGKILL. @default 5000 */
  graceMs?: number;
}

export interface WorkerOptions extends RunOptions {
  /** Moved to the worker rather than copied. */
  transfer?: Transferable[];
}

type Checkpoint = (release?: Effect.Effect<number | void>) => Effect.Effect<void>;
// `self`: a job already running that gave its slot back, and waits for one again.
type Waiting = { priority: "normal" | "low"; memMb: number; start: () => void; self?: Live };
type Live = {
  priority: Priority; memMb: number; measuredMb: number; maxMb?: number; pause: boolean; pids: Set<number>; order: number;
  away: "parked" | "paused" | null; stop: (e: JobStopped) => void; hold: () => void;
};
const background = (p: Priority): p is "normal" | "low" => p === "normal" || p === "low";
// With the DOM lib loaded, the global Worker types as the DOM's; at run time it's Bun's, which has ref/unref.
type BunWorker = Worker & Pick<Bun.Worker, "ref" | "unref">;

export function scheduler(o: SchedulerOptions = {}) {
  const budget: Budget = { ...PERSONAS[o.persona ?? "balanced"], ...o.budget };
  const cores = o.cores ?? availableParallelism();
  const slots = Math.max(1, Math.min(o.max ?? Infinity, Math.floor(cores * budget.cpu) - budget.reserve));
  const memBudgetMb = (o.totalMb ?? totalmem() / 2 ** 20) * budget.memory;
  const window = o.window ?? 6, sample = o.sample ?? machineLoad, measure = o.measure ?? processTreeMb, log = o.log ?? (() => {});
  const running: Record<Priority, number> = { realtime: 0, high: 0, normal: 0, low: 0 };
  const queue: Waiting[] = [];
  const live = new Set<Live>();
  let back: Backoff = { limit: slots, hot: 0, cool: 0 }, load: Load | null = null, seq = 0;
  const warm = o.warm ?? 0, workerMb = o.workerMb ?? 30;
  const idle: { url: string; w: BunWorker }[] = [];

  // A background job counts for what it said it takes, or what it was last measured at if more; an idle worker for workerMb.
  const held = (j: Live) => Math.max(j.memMb, j.measuredMb);
  const usedMb = () => { let mb = idle.length * workerMb; for (const j of live) if (background(j.priority)) mb += held(j); return mb; };
  // The pool never holds more than `warm`, nor more than low work may run at once.
  const shrink = (to = Math.min(warm, back.limit)) => { while (idle.length > to) idle.shift()!.w.terminate(); };

  function fits(j: Waiting) {
    if (running.normal + running.low >= slots) return false;
    if (j.priority === "low" && running.low >= back.limit) return false;
    // nothing else running: a job bigger than the whole budget still gets its turn alone
    for (;;) {
      const used = usedMb();
      if (used === (j.self ? held(j.self) : 0) || used + j.memMb <= memBudgetMb) return true;
      if (!idle.length) return false;
      idle.shift()!.w.terminate();        // an idle worker gives its memory to a job that needs it
    }
  }

  function pump() {
    // normal before low, each in arrival order; a low job that can't start doesn't hold up a normal one
    for (const p of ["normal", "low"] as const) {
      for (let i = 0; i < queue.length; ) {
        const j = queue[i]!;
        if (j.priority !== p || !fits(j)) { i++; continue; }
        queue.splice(i, 1);
        j.start();
      }
    }
  }

  // A low job steps aside at a checkpoint when the sampler has cut low below what is running, or when
  // the slots are full and a normal job waits that would fit in the one it gives back. One that can let
  // memory go (low or normal) steps aside too while background work is over the memory budget.
  function crowded(j: Live, releasing: boolean) {
    if (!background(j.priority)) return false;
    if (releasing && usedMb() > memBudgetMb) return true;
    if (j.priority !== "low") return false;
    if (running.low > back.limit) return true;
    if (running.normal + running.low < slots) return false;
    const used = usedMb();
    return queue.some((w) => w.priority === "normal" && !w.self && (used === 0 || used + w.memMb <= memBudgetMb));
  }

  function run<T>(priority: Priority, fn: (job: JobContext) => T | Promise<T>, opts: RunOptions = {}): Promise<T> {
    return submit(priority, (job) => fn(job), opts);
  }

  // run, with the job's checkpoint also handed over as the Effect it is underneath, for runEffect.
  function submit<T>(priority: Priority, fn: (job: JobContext, checkpoint: Checkpoint) => T | Promise<T>, opts: RunOptions): Promise<T> {
    let memMb = opts.memMb ?? 0, requeues = opts.requeues ?? 0;
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        const ctrl = new AbortController();
        let done = false;
        const job: Live = { priority, memMb, measuredMb: 0, maxMb: opts.maxMb, pause: !!opts.pause && process.platform !== "win32", pids: new Set(), order: ++seq, away: null, stop: () => {}, hold: () => {} };
        let parking: { w: Waiting; resume: () => void; fail: (e: unknown) => void } | undefined;
        // The timeout counts time spent holding a slot: parked or paused, the clock stops.
        let left = opts.timeoutMs, since = 0, timer: ReturnType<typeof setTimeout> | undefined;
        const clock = (on: boolean) => {
          if (left === undefined) return;
          if (on && !timer) {
            since = Date.now();
            timer = setTimeout(() => job.stop(new JobStopped("timeout", `stopped after ${opts.timeoutMs} ms`)), left);
            (timer as any).unref?.();
          } else if (!on && timer) { clearTimeout(timer); timer = undefined; left = Math.max(0, left - (Date.now() - since)); }
        };
        const cont = () => signalTrees(job.pids, "SIGCONT");
        const finish = (settle: () => void, stopped?: JobStopped) => {
          if (done) return;
          done = true;
          clock(false);
          if (!job.away) running[priority]--;
          if (job.away === "paused") cont();      // a stopped child can't act on the SIGTERM a stop sends
          live.delete(job);
          if (stopped) ctrl.abort(stopped);
          if (parking) {
            const i = queue.indexOf(parking.w);
            if (i >= 0) queue.splice(i, 1);
            stopped ? parking.fail(stopped) : parking.resume();
            parking = undefined;
          }
          if (stopped?.reason === "evicted" && requeues-- > 0) { memMb = Math.max(memMb, job.measuredMb); enqueue(start, true); }
          else settle();
          pump();
        };
        job.stop = (e) => finish(() => reject(e), e);
        running[priority]++;
        live.add(job);
        clock(true);
        let out: Promise<T>;
        // Hand the slot back and wait at the front of the class, still counted in usedMb, so the way back
        // in claims only `need`: what the job let go and will take again.
        const park = (away: "parked" | "paused", need: number, resume: () => void, fail: (e: unknown) => void) => {
          const w: Waiting = { priority: priority as "normal" | "low", memMb: need, self: job, start: () => { parking = undefined; job.away = null; running[priority]++; clock(true); resume(); } };
          parking = { w, resume, fail };
          job.away = away;
          running[priority]--;
          clock(false);
          queue.unshift(w);
          pump();
        };
        job.hold = () => { signalTrees(job.pids, "SIGSTOP"); park("paused", 0, cont, () => {}); };
        // An Effect, so in runEffect the release runs in the job's own fiber, where a stop interrupts it (#1079).
        const checkpoint = (release?: Effect.Effect<number | void>): Effect.Effect<void> => Effect.gen(function* () {
          if (ctrl.signal.aborted) return yield* Effect.die(ctrl.signal.reason);
          if (done || parking || !crowded(job, !!release)) return;
          const before = held(job);
          const after = release ? yield* release : undefined;
          if (ctrl.signal.aborted) return yield* Effect.die(ctrl.signal.reason);
          if (done || parking) return;
          let need = 0;
          if (typeof after === "number" && after < before) {
            job.memMb = after; job.measuredMb = Math.min(job.measuredMb, after); need = before - after;
            log(`[priority] a ${priority} job let ${Math.round(need)} MB go at a checkpoint`);
          }
          yield* Effect.callback<void>((resume) => {
            park("parked", need, () => { if (need) job.memMb = before; resume(Effect.void); }, (e) => resume(Effect.die(e)));
            log(`[priority] a ${priority} job gave its slot back at a checkpoint`);
            const w = parking!.w;
            // Interrupted while parked (not by a stop, which settles the parking itself): the job runs on,
            // so it leaves the queue and holds a slot again, past `slots` if it must.
            return Effect.sync(() => {
              if (parking?.w !== w) return;
              queue.splice(queue.indexOf(w), 1);
              parking = undefined; job.away = null; running[priority]++; clock(true);
              if (need) job.memMb = before;
            });
          });
        });
        const ctx: JobContext = {
          signal: ctrl.signal, track: (pid) => void job.pids.add(pid),
          checkpoint: (release) => Effect.runPromise(checkpoint(release && Effect.promise(async () => release()))),
        };
        try { out = Promise.resolve(fn(ctx, checkpoint)); } catch (e) { out = Promise.reject(e); }
        out.then((v) => finish(() => resolve(v)), (e) => finish(() => reject(e)));
      };
      const enqueue = (go: () => void, front = false) => {
        if (!background(priority)) return go();
        const w: Waiting = { priority, memMb, start: go };
        front ? queue.unshift(w) : queue.push(w);
        pump();
      };
      enqueue(start);
    });
  }

  /** `make(job)` as a job, run in a fiber that a stop (timeout, memory, eviction) interrupts wherever it
   *  is, so its finalizers run and none of it goes on outside the budget. `yield* job.checkpoint` between
   *  steps lets a low job give its slot back to normal work. */
  function runEffect<A, E>(priority: Priority, make: (job: EffectJobContext) => Effect.Effect<A, E>, opts: RunOptions = {}): Promise<A> {
    return submit(priority, (job, checkpoint) => Effect.runPromise(make({
      signal: job.signal, track: job.track, checkpoint: checkpoint(), checkpointWith: checkpoint,
    }), { signal: job.signal }), opts);
  }

  /** `cmd` as a job: low runs at the OS's background priority, `maxMb` is a hard cap where the OS has one
   *  (a cgroup on Linux), and a stop kills the child (SIGTERM, then SIGKILL) and its descendants. */
  function spawn(priority: Priority, cmd: string[], opts: SpawnOptions = {}) {
    return run(priority, async (job) => {
      let argv = priority === "low" ? lowPriorityCommand(cmd) : cmd;
      if (opts.maxMb) argv = hardCap(argv, opts.maxMb);
      const p = Bun.spawn(argv, { cwd: opts.cwd, env: opts.env, stdin: "ignore", stdout: opts.stdout ?? "inherit", stderr: opts.stderr ?? "inherit" });
      job.track(p.pid);
      const kill = () => {
        const tree = [...treeDescendants(p.pid), p.pid];
        const signal = (s: NodeJS.Signals) => { for (const pid of tree) try { process.kill(pid, s); } catch {} };
        signal("SIGTERM");
        const t = setTimeout(() => signal("SIGKILL"), opts.graceMs ?? 5000);
        (t as any).unref?.();
        void p.exited.then(() => clearTimeout(t));
      };
      if (job.signal.aborted) kill(); else job.signal.addEventListener("abort", kill, { once: true });
      const exitCode = await p.exited;
      return { exitCode, signal: p.signalCode ?? null, stdout: p.stdout, stderr: p.stderr };
    }, opts);
  }

  /** `data` posted to a worker thread on module `url`; its first message back is the result. A stop
   *  terminates the thread. A worker that answered goes back to the warm pool (if there's room) for the
   *  next job on the same `url`, so the module must handle one message after another; one that threw
   *  is terminated. `memMb` defaults to `workerMb`. */
  function worker<T = unknown>(priority: Priority, url: string | URL, data?: unknown, opts: WorkerOptions = {}) {
    const href = String(url);
    return run<T>(priority, (job) => new Promise<T>((resolve, reject) => {
      const i = idle.findIndex((x) => x.url === href);
      const w = i >= 0 ? idle.splice(i, 1)[0]!.w : new Worker(href) as BunWorker;
      w.ref();
      const off = () => { w.onmessage = null; w.onerror = null; job.signal.removeEventListener("abort", stop); };
      const stop = () => { off(); w.terminate(); reject(job.signal.reason); };
      w.onmessage = (e: MessageEvent) => {
        off();
        // an idle worker doesn't keep the process alive
        if (idle.length < Math.min(warm, back.limit)) { w.unref(); idle.push({ url: href, w }); } else w.terminate();
        resolve(e.data as T);
      };
      w.onerror = (e: ErrorEvent) => { e.preventDefault(); off(); w.terminate(); reject(e.error ?? new Error(e.message)); };
      job.signal.addEventListener("abort", stop, { once: true });
      w.postMessage(data, opts.transfer ?? []);
    }), { ...opts, memMb: opts.memMb ?? workerMb });
  }

  /** Measure the jobs that track processes. One past its own maxMb is stopped. While the background work
   *  is over the memory budget, the newest measured job (low before normal) is put out, or paused if it
   *  asked to be; the oldest running keeps going. A pause frees nothing yet, so it counts as room made
   *  until the next sample measures what the kernel paged out. */
  function watch() {
    const tracked = [...live].filter((j) => j.pids.size);
    if (!tracked.length) return;
    const sizes = measure(tracked.flatMap((j) => [...j.pids]));
    for (const j of tracked) j.measuredMb = [...j.pids].reduce((mb, pid) => mb + (sizes.get(pid) ?? 0), 0);
    for (const j of tracked) if (j.maxMb && j.measuredMb > j.maxMb) {
      log(`[priority] stopped a ${j.priority} job at ${Math.round(j.measuredMb)} MB, over its ${j.maxMb} MB`);
      j.stop(new JobStopped("memory", `took ${Math.round(j.measuredMb)} MB, over its ${j.maxMb} MB`));
    }
    for (let room = 0; ;) {
      const used = usedMb();
      if (used - room <= memBudgetMb) break;
      const bg = [...live].filter((j) => background(j.priority) && !j.away).sort((a, b) => a.order - b.order);
      const victim = bg.slice(1).filter((j) => j.measuredMb > 0)
        .sort((a, b) => a.priority === b.priority ? b.order - a.order : a.priority === "low" ? -1 : 1)[0];
      if (!victim) break;
      if (victim.pause && victim.pids.size) {
        log(`[priority] paused a ${victim.priority} job at ${Math.round(victim.measuredMb)} MB: background work at ${Math.round(used)} of ${Math.round(memBudgetMb)} MB`);
        room += victim.measuredMb;
        victim.hold();
        continue;
      }
      log(`[priority] put out a ${victim.priority} job at ${Math.round(victim.measuredMb)} MB: background work at ${Math.round(used)} of ${Math.round(memBudgetMb)} MB`);
      victim.stop(new JobStopped("evicted", `put out at ${Math.round(victim.measuredMb)} MB to keep background work under ${Math.round(memBudgetMb)} MB`));
    }
  }

  function tick() {
    load = sample();
    const before = back.limit;
    back = adapt(back, load, budget, slots, window);
    shrink();
    if (back.limit !== before) {
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      log(`[priority] low ${before} -> ${back.limit} of ${slots} (cpu ${pct(load.cpu)}, memory ${pct(load.memory)}; budget ${pct(budget.cpu)} / ${pct(budget.memory)})`);
    }
    watch();
    pump();
  }

  const everyMs = o.everyMs ?? 5000;
  const timer = everyMs > 0 ? setInterval(tick, everyMs) : undefined;
  (timer as any)?.unref?.();

  const away = (a: Live["away"]) => { let n = 0; for (const j of live) if (j.away === a) n++; return n; };
  const stats = (): SchedulerStats => ({
    slots, lowLimit: back.limit, running: { ...running },
    queued: { normal: queue.filter((j) => j.priority === "normal" && !j.self).length, low: queue.filter((j) => j.priority === "low" && !j.self).length },
    parked: away("parked"), paused: away("paused"),
    memMb: { used: Math.round(usedMb()), budget: Math.round(memBudgetMb) }, warm: idle.length, load,
  });
  /** Stops the sampler and lets the idle workers go. */
  const stop = () => { clearInterval(timer); shrink(0); };
  return { run, runEffect, spawn, worker, tick, stats, budget, stop };
}

/** `signal` to each of `pids` and its descendants. One that's gone, or a signal the OS lacks, is skipped. */
function signalTrees(pids: Iterable<number>, signal: NodeJS.Signals) {
  for (const pid of pids) for (const p of [pid, ...treeDescendants(pid)]) try { process.kill(p, signal); } catch {}
}

/** Every descendant of `pid`, deepest last. */
function treeDescendants(pid: number): number[] {
  const kids = new Map<number, number[]>();
  for (const line of ps().split("\n")) {
    const [p, pp] = line.trim().split(/\s+/).map(Number);
    if (p && pp !== undefined) (kids.get(pp) ?? kids.set(pp, []).get(pp)!).push(p);
  }
  const out: number[] = [];
  for (const stack = [...kids.get(pid) ?? []]; stack.length;) { const p = stack.shift()!; out.push(p); stack.push(...kids.get(p) ?? []); }
  return out;
}

export type Scheduler = ReturnType<typeof scheduler>;

let host: Scheduler | undefined;

/** This process's scheduler, made on first use: crons and queue consumers run through it. Its
 *  persona is `RB_PERSONA` (balanced when unset); a name it doesn't know is reported and ignored. */
export function hostScheduler(): Scheduler {
  if (host) return host;
  const asked = process.env.RB_PERSONA;
  const persona = asked && asked in PERSONAS ? asked as Persona : "balanced";
  if (asked && persona !== asked) console.warn(`[priority] RB_PERSONA=${asked}: not one of ${Object.keys(PERSONAS).join(", ")}; using balanced`);
  return (host = scheduler({ persona, log: (l) => console.log(l) }));
}
