// `bun packages/cli/bench/concurrency.ts`: does Effect make the CLI's concurrent work faster or lighter?
//
//   micro     100k tiny async tasks, Promise.all vs Effect.forEach, each in a fresh process:
//             wall time and heap. What the fiber runtime costs per task.
//   typecheck the 18 `bun check` processes of `bun run typecheck`: all at once (today) vs
//             at most N at a time. Wall time and the peak RSS of all of them together.
//   failfast  the same 18 plus one that fails at once: Promise.all of exit codes waits for the
//             rest; one that rejects returns at once but leaves them running; Effect
//             interrupts them, and the interrupt kills their processes.
import { existsSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Effect } from "effect";

const ROOT = new URL("../../..", import.meta.url).pathname;
const RUNS = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

// ---- micro: one mode per child process, so heaps don't mix ----
const MICRO = ["promise", "effect-promise", "effect-native"] as const;
async function microChild(mode: (typeof MICRO)[number], n = 100_000) {
  Bun.gc(true);
  const heap0 = process.memoryUsage().heapUsed, t = performance.now();
  const work = (i: number) => Promise.resolve(i * 2);
  if (mode === "promise") await Promise.all(Array.from({ length: n }, (_, i) => work(i)));
  else if (mode === "effect-promise") await Effect.runPromise(Effect.forEach(Array.from({ length: n }, (_, i) => i), (i) => Effect.promise(() => work(i)), { concurrency: "unbounded" }));
  else await Effect.runPromise(Effect.forEach(Array.from({ length: n }, (_, i) => i), (i) => Effect.succeed(i * 2), { concurrency: "unbounded" }));
  const ms = performance.now() - t, heapMb = (process.memoryUsage().heapUsed - heap0) / 1e6;
  console.log(JSON.stringify({ ms, heapMb }));
}

// ---- typecheck: real processes ----
const projects = ["tsconfig.json", ...readdirSync(`${ROOT}apps`).sort().map((a) => `apps/${a}/tsconfig.json`).filter((p) => existsSync(`${ROOT}${p}`))];
const check = (p: string) => [process.execPath, "check", "-p", p, "--no-pretty"];
const FAIL = [process.execPath, "-e", "process.exit(1)"];

/** Sum of RSS (MB) over live pids, sampled every 50ms; returns the peak when stopped. */
function rssSampler(pids: Set<number>) {
  let peak = 0, on = true;
  (async () => {
    while (on) {
      if (pids.size) {
        const out = Bun.spawnSync(["ps", "-o", "rss=", "-p", [...pids].join(",")]).stdout.toString();
        peak = Math.max(peak, out.split("\n").reduce((s, l) => s + (Number(l.trim()) || 0), 0) / 1024);
      }
      await Bun.sleep(50);
    }
  })();
  return () => { on = false; return peak; };
}

const run = (cmd: string[], pids: Set<number>) => {
  const p = Bun.spawn(cmd, { cwd: ROOT, stdout: "ignore", stderr: "ignore" });
  pids.add(p.pid);
  return { p, done: p.exited.then((code) => { pids.delete(p.pid); return code; }) };
};

async function viaPromiseAll(cmds: string[][]) {
  const pids = new Set<number>(), stop = rssSampler(pids), t = performance.now();
  const codes = await Promise.all(cmds.map((c) => run(c, pids).done));
  return { ms: performance.now() - t, rssMb: stop(), failed: codes.filter(Boolean).length };
}

/** Promise.all that rejects on the first failure: returns as soon, but the rest keep running. */
async function viaPromiseReject(cmds: string[][]) {
  const pids = new Set<number>(), stop = rssSampler(pids), t = performance.now();
  await Promise.all(cmds.map((c) => run(c, pids).done.then((code) => { if (code) throw code; }))).catch(() => {});
  const ms = performance.now() - t, orphans = pids.size;
  while (pids.size) await Bun.sleep(20);   // wait them out before the next run
  return { ms, rssMb: stop(), orphans };
}

async function viaEffect(cmds: string[][], concurrency: number | "unbounded", failFast: boolean) {
  const pids = new Set<number>(), stop = rssSampler(pids), t = performance.now();
  const one = (c: string[]) => Effect.callback<number>((resume) => {
    const { p, done } = run(c, pids);
    done.then((code) => resume(failFast && code !== 0 ? Effect.fail(code) as never : Effect.succeed(code)));
    return Effect.sync(() => p.kill());   // interrupted: kill the process
  });
  const exit = await Effect.runPromiseExit(Effect.forEach(cmds, one, { concurrency }));
  const ms = performance.now() - t;
  await Bun.sleep(100);   // let killed processes go before the next run
  return { ms, rssMb: stop(), failed: exit._tag === "Failure" ? 1 : (exit.value as number[]).filter(Boolean).length };
}

async function bench(label: string, f: () => Promise<{ ms: number; rssMb: number; orphans?: number }>) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) rs.push(await f());
  const orphans = rs[0]!.orphans === undefined ? "" : `   still running after it returned: ${median(rs.map((r) => r.orphans!))}`;
  console.log(`  ${label.padEnd(34)} ${median(rs.map((r) => r.ms)).toFixed(0).padStart(6)} ms   peak RSS ${median(rs.map((r) => r.rssMb)).toFixed(0).padStart(5)} MB${orphans}`);
}

if (process.argv[2] === "--micro-child") await microChild(process.argv[3] as (typeof MICRO)[number]);
else {
  const cores = availableParallelism();
  console.log(`bun ${Bun.version}, ${cores} cores, median of ${RUNS}\n\nmicro: 100k async tasks (fresh process each)`);
  for (const m of MICRO) {
    const rs = Array.from({ length: RUNS }, () => JSON.parse(Bun.spawnSync([process.execPath, import.meta.path, "--micro-child", m]).stdout.toString()));
    console.log(`  ${m.padEnd(34)} ${median(rs.map((r) => r.ms)).toFixed(0).padStart(6)} ms   heap +${median(rs.map((r) => r.heapMb)).toFixed(0)} MB`);
  }
  const cmds = projects.map(check);
  console.log(`\ntypecheck: ${cmds.length} bun check processes`);
  await bench("Promise.all (today)", () => viaPromiseAll(cmds));
  await bench("Effect, unbounded", () => viaEffect(cmds, "unbounded", false));
  for (const n of [cores, cores / 2]) await bench(`Effect, concurrency ${n}`, () => viaEffect(cmds, n, false));
  const failing = [FAIL, ...cmds];
  console.log(`\nfailfast: the same plus one that fails at once`);
  await bench("Promise.all waits for all", () => viaPromiseAll(failing));
  await bench("Promise.all rejects, no kill", () => viaPromiseReject(failing));
  await bench("Effect interrupts the rest", () => viaEffect(failing, "unbounded", true));
}
