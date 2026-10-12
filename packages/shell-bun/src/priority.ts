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
//
// Child processes of low work get OS background priority too (`lowPriorityCommand`), so the kernel
// prefers everything else even while they run.
//
// A host has one scheduler (`hostScheduler()`), so its crons and queue consumers share one budget.
// They run as low unless they say otherwise; `RB_PERSONA` at launch picks the budget (#1018).

import { availableParallelism, cpus, freemem, totalmem } from "node:os";

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
  log?: (line: string) => void;
}

export interface SchedulerStats {
  slots: number;
  lowLimit: number;
  running: Record<Priority, number>;
  queued: { normal: number; low: number };
  memMb: { used: number; budget: number };
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

type Job = { priority: "normal" | "low"; memMb: number; start: () => void };

export function scheduler(o: SchedulerOptions = {}) {
  const budget: Budget = { ...PERSONAS[o.persona ?? "balanced"], ...o.budget };
  const cores = o.cores ?? availableParallelism();
  const slots = Math.max(1, Math.min(o.max ?? Infinity, Math.floor(cores * budget.cpu) - budget.reserve));
  const memBudgetMb = (o.totalMb ?? totalmem() / 2 ** 20) * budget.memory;
  const window = o.window ?? 6, sample = o.sample ?? machineLoad, log = o.log ?? (() => {});
  const running: Record<Priority, number> = { realtime: 0, high: 0, normal: 0, low: 0 };
  const queue: Job[] = [];
  let back: Backoff = { limit: slots, hot: 0, cool: 0 }, usedMb = 0, load: Load | null = null;

  function fits(j: Job) {
    if (running.normal + running.low >= slots) return false;
    if (j.priority === "low" && running.low >= back.limit) return false;
    // nothing running: a job bigger than the whole budget still gets its turn alone
    return usedMb === 0 || usedMb + j.memMb <= memBudgetMb;
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

  function run<T>(priority: Priority, fn: () => T | Promise<T>, opts: { memMb?: number } = {}): Promise<T> {
    const memMb = opts.memMb ?? 0;
    const go = async () => {
      running[priority]++;
      if (priority === "normal" || priority === "low") usedMb += memMb;
      try { return await fn(); } finally {
        running[priority]--;
        if (priority === "normal" || priority === "low") { usedMb -= memMb; pump(); }
      }
    };
    if (priority === "realtime" || priority === "high") return go();
    return new Promise<T>((resolve, reject) => {
      queue.push({ priority, memMb, start: () => go().then(resolve, reject) });
      pump();
    });
  }

  function tick() {
    load = sample();
    const before = back.limit;
    back = adapt(back, load, budget, slots, window);
    if (back.limit !== before) {
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      log(`[priority] low ${before} -> ${back.limit} of ${slots} (cpu ${pct(load.cpu)}, memory ${pct(load.memory)}; budget ${pct(budget.cpu)} / ${pct(budget.memory)})`);
      pump();
    }
  }

  const everyMs = o.everyMs ?? 5000;
  const timer = everyMs > 0 ? setInterval(tick, everyMs) : undefined;
  (timer as any)?.unref?.();

  const stats = (): SchedulerStats => ({
    slots, lowLimit: back.limit, running: { ...running },
    queued: { normal: queue.filter((j) => j.priority === "normal").length, low: queue.filter((j) => j.priority === "low").length },
    memMb: { used: usedMb, budget: Math.round(memBudgetMb) }, load,
  });
  return { run, tick, stats, budget, stop: () => clearInterval(timer) };
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
