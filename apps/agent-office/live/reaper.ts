// Processes that outlive their owners, ended (#4905). On 2026-11-16 the 16 GB office Mac froze with 23 of 24.5 GB of swap
// taken by leftovers: headless Chromes, dev servers whose worktree was deleted, and `claude` sessions of workers sent home.
//
//  1. `endIn(dir)`: sending a worker home ends every process whose working directory is inside its worktree (its claude,
//     the dev servers and watchers it started), TERM then KILL, before the worktree goes. Never the office or its parents.
//  2. `reapOrphans`: every 5 minutes the office ends processes whose parent is pid 1 (nobody waits on them) and whose
//     working directory is in a worktree that is gone, or that no worker sits at.
//  3. `swapUsage`: the swap gauge. Over `SWAP_HOLD` the office says so on the floor and holds new hires (`swapHold`);
//     mem_stats reports it with the reaper's count.
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { WORKTREES } from "./sweep.ts";

export interface Proc { pid: number; ppid: number; cwd: string; args: string }

const run = (cmd: string[]) => {
  try { return Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore" }).stdout.toString(); } catch { return ""; }
};

/** Every process we can see, with its parent and working directory (lsof on a Mac, /proc on Linux). A deleted cwd keeps its old path. */
export function processes(): Proc[] {
  const cwds = new Map<number, string>();
  if (process.platform === "linux") {
    for (const d of readdirSync("/proc").filter((n) => /^\d+$/.test(n)))
      try { cwds.set(Number(d), readlinkSync(`/proc/${d}/cwd`).replace(/ \(deleted\)$/, "")); } catch {}
  } else {
    let pid = 0;
    for (const l of run(["lsof", "-d", "cwd", "-n", "-P", "-Fpn"]).split("\n")) {
      if (l[0] === "p") pid = Number(l.slice(1));
      else if (l[0] === "n" && pid) cwds.set(pid, l.slice(1));
    }
  }
  const out: Proc[] = [];
  for (const l of run(["ps", "-A", "-o", "pid=,ppid=,args="]).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(l);
    if (!m) continue;
    const pid = Number(m[1]);
    out.push({ pid, ppid: Number(m[2]), cwd: cwds.get(pid) ?? "", args: m[3]!.trim() });
  }
  return out;
}

/** `dir` and its resolved path (/tmp is /private/tmp on a Mac), so a cwd matches whichever one the kernel reports. */
function spellings(dir: string): string[] {
  const out = new Set([path.resolve(dir)]);
  try { out.add(realpathSync(dir)); } catch {}
  return [...out];
}

const inside = (cwd: string, dirs: string[]) => !!cwd && dirs.some((d) => cwd === d || cwd.startsWith(d + path.sep));

/** This process and each of its parents: never ended, even when the office itself was started in the worktree. */
function ours(procs: Proc[], self = process.pid): Set<number> {
  const parent = new Map(procs.map((p) => [p.pid, p.ppid]));
  const keep = new Set<number>();
  for (let p: number | undefined = self; p && !keep.has(p); p = parent.get(p)) keep.add(p);
  return keep;
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** TERM each pid, KILL whichever still run after `graceMs`. Resolves with how many were signalled. */
export async function end(pids: number[], graceMs = 2000): Promise<number> {
  const sent = pids.filter((p) => { try { process.kill(p, "SIGTERM"); return true; } catch { return false; } });
  const t0 = Date.now();
  while (sent.some(alive) && Date.now() - t0 < graceMs) await Bun.sleep(100);
  for (const p of sent.filter(alive)) try { process.kill(p, "SIGKILL"); } catch {}
  return sent.length;
}

/** The pids whose working directory is inside `dir`, less the office and its parents. */
export function pidsIn(dir: string, procs = processes(), self = process.pid): number[] {
  if (!dir) return [];
  const dirs = spellings(dir), keep = ours(procs, self);
  return procs.filter((p) => !keep.has(p.pid) && inside(p.cwd, dirs)).map((p) => p.pid);
}

/** Send-home's hook: end everything running in a worker's worktree. Never throws; resolves with the count. */
export async function endIn(dir: string): Promise<number> {
  try { return await end(pidsIn(dir)); } catch { return 0; }
}

export interface ReapFloor { dir: string; workers?: { list(): { worktree?: { path?: string } }[] } }

/**
 * The orphans to end: parent pid 1, working directory in one of `floors`' worktrees that is gone or no worker sits at.
 * A floor that can't list its workers only loses orphans of worktrees that are gone.
 */
export function orphans(floors: Iterable<ReapFloor>, procs = processes(), self = process.pid): Proc[] {
  const keep = ours(procs, self);
  const lone = procs.filter((p) => p.ppid === 1 && !keep.has(p.pid) && p.cwd);
  const out: Proc[] = [];
  for (const f of floors) {
    const seated = f.workers ? new Set(f.workers.list().flatMap((w) => (w.worktree?.path ? [path.basename(w.worktree.path)] : []))) : undefined;
    for (const root of spellings(path.join(f.dir, WORKTREES))) {
      for (const p of lone) {
        if (!p.cwd.startsWith(root + path.sep)) continue;
        const name = p.cwd.slice(root.length + 1).split(path.sep)[0]!;
        const gone = !existsSync(path.join(root, name));
        if ((gone || (seated && !seated.has(name))) && !out.includes(p)) out.push(p);
      }
    }
  }
  return out;
}

export interface Swap { usedMb: number; totalMb: number; pct: number }

/** `sysctl vm.swapusage` on a Mac ("total = 24576.00M  used = 23200.00M  free = ..."), /proc/meminfo on Linux; null with no swap. */
export function parseSwap(text: string): Swap | null {
  const mac = /total = ([\d.]+)M\s+used = ([\d.]+)M/.exec(text);
  const lin = /SwapTotal:\s+(\d+) kB[\s\S]*SwapFree:\s+(\d+) kB/.exec(text);
  const [totalMb, usedMb] = mac ? [Number(mac[1]), Number(mac[2])] : lin ? [Number(lin[1]) / 1024, (Number(lin[1]) - Number(lin[2])) / 1024] : [0, 0];
  return totalMb > 0 ? { usedMb: Math.round(usedMb), totalMb: Math.round(totalMb), pct: Math.round((usedMb / totalMb) * 100) } : null;
}

export function swapUsage(): Swap | null {
  if (process.platform === "linux") try { return parseSwap(readFileSync("/proc/meminfo", "utf8")); } catch { return null; }
  return parseSwap(run(["sysctl", "-n", "vm.swapusage"]));
}

/** Swap above this share holds new hires: 80%, or AGENT_OFFICE_SWAP_HOLD (a percentage, or off). */
export const SWAP_HOLD = 80;
const holdAt = () => { const v = process.env.AGENT_OFFICE_SWAP_HOLD; return v === "off" ? Infinity : Number(v) || SWAP_HOLD; };

/** Why a hire waits, or undefined when it can go ahead. */
export function swapHold(swap = swapUsage()): string | undefined {
  const at = holdAt();
  if (!swap || swap.pct <= at) return undefined;
  return `Swap is at ${swap.pct}% (${(swap.usedMb / 1024).toFixed(1)} of ${(swap.totalMb / 1024).toFixed(1)} GB): no new hires until it is under ${at}%. Send someone home or stop what they left running (#4905)`;
}

export interface ReaperStats { reaped: number; lastReaped: string[]; swap: Swap | null; hold: number | null; at: number }

const stats: ReaperStats = { reaped: 0, lastReaped: [], swap: null, hold: SWAP_HOLD, at: 0 };

/** What the reaper has done since the office started, for /__rb/mem. */
export const reaperStats = (): ReaperStats => ({ ...stats, hold: Number.isFinite(holdAt()) ? holdAt() : null, lastReaped: [...stats.lastReaped] });

/** One round: end the orphans, read the swap, and say on the floor once when swap crosses SWAP_HOLD. */
export async function reapOnce(floors: () => Iterable<ReapFloor>, toast: (message: string) => void, read = { procs: processes, swap: swapUsage }) {
  const found = orphans(floors(), read.procs());
  const n = await end(found.map((p) => p.pid));
  stats.reaped += n;
  if (n) {
    stats.lastReaped = found.slice(0, 10).map((p) => `${p.pid} ${p.args.slice(0, 80)} (in ${p.cwd})`);
    toast(`Ended ${n} leftover process${n === 1 ? "" : "es"} of worktrees nobody sits at (#4905)`);
  }
  const was = stats.swap?.pct ?? 0;
  stats.swap = read.swap();
  stats.at = Date.now();
  const hold = swapHold(stats.swap);
  if (hold && was <= holdAt()) toast(hold);
  return n;
}

/** Every `everyMs` (5 minutes, beside the mem samples), a reaper round. The office starts it once. */
export function startReaper(floors: () => Iterable<ReapFloor>, toast: (message: string) => void, everyMs = 300_000) {
  const tick = () => void reapOnce(floors, toast).catch((e) => console.warn("[rb] reaper:", (e as Error).message));
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
