// Processes that outlive their owners, ended (#4905). On 2026-11-16 the 16 GB office Mac froze with 23 of 24.5 GB of swap
// taken by leftovers: headless Chromes, dev servers whose worktree was deleted, and `claude` sessions of workers sent home.
//
//  1. `endIn(dir)`: sending a worker home ends every process whose working directory is inside its worktree (its claude,
//     the dev servers and watchers it started), TERM then KILL, before the worktree goes. Never the office or its parents.
//  2. `reapOrphans`: every 5 minutes the office ends processes whose parent is pid 1 (nobody waits on them) and whose
//     working directory is in a worktree that is gone, or that no worker sits at, and stopped (state T) orphaned claude
//     sessions with their office-workers mcp and caffeinate children, which lsof gives no working directory (#5209).
//     Also (2026-11-23, when leftovers held the office to three workers): an orphan in a session's scratch folder of such
//     a worktree (`/tmp/claude-<uid>/<the worktree's path, - for /, .>/...`: a `python -m http.server` there ran 26 days),
//     and a Claude Code shell whose session is gone (`zsh -c source ~/.claude/shell-snapshots/...` under pid 1: a watch
//     loop polling `office-workers list` or `gh pr list` every 30 s for ten days after its session ended), wherever it sits.
//  3. `swapUsage`: the swap gauge. Over `SWAP_HOLD` the office says so on the floor and holds new hires (`swapHold`),
//     naming what holds the memory (`heavy`: the top three by memory, a system one said plainly, as fseventsd at 27 GB
//     after a month up, cleared by a restart, or Docker's VM); mem_stats reports it with the reaper's count.
//  4. `stuck`: a process of the office's (under it, or in one of its worktrees) that is stopped (ps state T) on two rounds
//     in a row gets SIGCONT. On 2026-11-18 about 90 sessions sat stopped for up to 6 days: the storage guard had paused
//     them with SIGSTOP, and a stopped process neither runs nor dies of the SIGHUP or SIGTERM sent when its worker
//     goes, while it keeps its memory in swap. `end` sends SIGCONT after SIGTERM for the same reason.
import { existsSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { WORKTREES } from "./sweep.ts";

export interface Proc { pid: number; ppid: number; cwd: string; args: string; /** ps state: T is stopped. */ stat?: string }

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
  for (const l of run(["ps", "-A", "-o", "pid=,ppid=,stat=,args="]).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s(.*)$/.exec(l);
    if (!m) continue;
    const pid = Number(m[1]);
    out.push({ pid, ppid: Number(m[2]), stat: m[3]!, cwd: cwds.get(pid) ?? "", args: m[4]!.trim() });
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

/** TERM each pid (then CONT, so a stopped one gets it), KILL whichever still run after `graceMs`. Resolves with how many were signalled. */
export async function end(pids: number[], graceMs = 2000): Promise<number> {
  const sent = pids.filter((p) => { try { process.kill(p, "SIGTERM"); process.kill(p, "SIGCONT"); return true; } catch { return false; } });
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

/** A worker session and what it starts: a stopped one whose office is gone waits for a SIGCONT nobody will send. */
const SESSION = /(^|[\s/])(claude|caffeinate)(\s|$)|office-workers\.js mcp/;

/** Stopped claude sessions whose parent is pid 1, and the stopped claude, mcp and caffeinate processes under them. */
export function stoppedLeftovers(procs: Proc[], self = process.pid): Proc[] {
  const keep = ours(procs, self);
  const out = new Set(procs.filter((p) => p.ppid === 1 && !!p.stat?.startsWith("T") && SESSION.test(p.args) && !keep.has(p.pid)));
  for (let grew = true; grew;) {
    grew = false;
    const pids = new Set([...out].map((p) => p.pid));
    for (const p of procs) if (!out.has(p) && pids.has(p.ppid) && !!p.stat?.startsWith("T") && SESSION.test(p.args) && !keep.has(p.pid)) { out.add(p); grew = true; }
  }
  return [...out];
}

/** A Claude Code session's scratch folder is under `claude-<uid>/<key>`, the key its project's path with every other character as -. */
const SCRATCH = /\/claude-\d+\/([^/]+)(\/|$)/;
const keyOf = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, "-");
/** A shell Claude Code runs a command or a monitor in: under pid 1, its session is gone. */
const SESSION_SHELL = /^\/bin\/(zsh|bash|sh) -c source \S*\/\.claude\/shell-snapshots\//;

/** Claude Code shells whose session is gone (parent pid 1), and what still runs under them. */
export function leftShells(procs: Proc[], self = process.pid): Proc[] {
  const keep = ours(procs, self);
  const out = new Set(procs.filter((p) => p.ppid === 1 && SESSION_SHELL.test(p.args) && !keep.has(p.pid)));
  for (let grew = true; grew;) {
    grew = false;
    const pids = new Set([...out].map((p) => p.pid));
    for (const p of procs) if (!out.has(p) && pids.has(p.ppid) && !keep.has(p.pid)) { out.add(p); grew = true; }
  }
  return [...out];
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
      const key = keyOf(root) + "-";
      for (const p of lone) {
        // in the worktree, or in a session's scratch folder of it
        const scratch = SCRATCH.exec(p.cwd)?.[1];
        const name = p.cwd.startsWith(root + path.sep) ? p.cwd.slice(root.length + 1).split(path.sep)[0]! : scratch?.startsWith(key) ? scratch.slice(key.length) : null;
        if (!name) continue;
        const gone = !existsSync(path.join(root, name));
        if ((gone || (seated && !seated.has(name))) && !out.includes(p)) out.push(p);
      }
    }
  }
  return out;
}

/** The office's own processes (under it, or in one of `floors`' worktrees), less the office and its parents. */
function office(floors: Iterable<ReapFloor>, procs: Proc[], self: number): Proc[] {
  const keep = ours(procs, self);
  const kids = new Map<number, number[]>();
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid]);
  const under = new Set<number>();
  for (const todo = [self]; todo.length;) for (const k of kids.get(todo.pop()!) ?? []) if (!under.has(k)) { under.add(k); todo.push(k); }
  const roots = [...floors].flatMap((f) => spellings(path.join(f.dir, WORKTREES)));
  return procs.filter((p) => !keep.has(p.pid) && (under.has(p.pid) || roots.some((r) => p.cwd.startsWith(r + path.sep))));
}

/**
 * The office's processes stopped now and on the round before (`seen`, which it updates): the ones to SIGCONT. One round
 * alone is not enough, so a process a person paused with ctrl-Z a moment ago, or caught mid-signal, is left alone.
 */
export function stuck(floors: Iterable<ReapFloor>, seen: Set<number>, procs = processes(), self = process.pid): Proc[] {
  const now = office(floors, procs, self).filter((p) => p.stat?.startsWith("T"));
  const out = now.filter((p) => seen.has(p.pid));
  seen.clear();
  for (const p of now) if (!out.includes(p)) seen.add(p.pid);
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

/** What a system process is, said plainly, and what clears it. */
const PLAIN: [RegExp, string][] = [
  [/^fseventsd$/, "fseventsd (macOS's file watcher: a restart clears it)"],
  [/^com\.apple\.Virtua/, "Docker's VM (quit Docker Desktop)"],
  [/^com\.docker/, "Docker (quit Docker Desktop)"],
];
/** `top -l 1 -o mem -stats command,mem` on a Mac: the biggest `n` as "name size", a system one in plain words. */
export function parseHeavy(text: string, n = 3): string[] {
  const rows = text.split("\n").map((l) => /^(.+?)\s+(\d+(?:\.\d+)?[KMG])\+?-?\s*$/.exec(l.trim())).filter((m): m is RegExpExecArray => !!m && m[1] !== "COMMAND");
  return rows.slice(0, n).map((m) => `${PLAIN.find(([re]) => re.test(m[1]!))?.[1] ?? m[1]!.trim()} ${m[2]}`);
}
export function heavy(): string[] {
  if (process.platform !== "darwin") return [];
  return parseHeavy(run(["top", "-l", "1", "-o", "mem", "-stats", "command,mem", "-n", "3"]));
}

/** Why a hire waits, or undefined when it can go ahead. `big`: what holds the memory (the reaper's last reading). */
export function swapHold(swap = swapUsage(), big = stats.heavy): string | undefined {
  const at = holdAt();
  if (!swap || swap.pct <= at) return undefined;
  return `Swap is at ${swap.pct}% (${(swap.usedMb / 1024).toFixed(1)} of ${(swap.totalMb / 1024).toFixed(1)} GB): no new hires until it is under ${at}%.${big.length ? ` Most of it: ${big.join(", ")}.` : ""} Send someone home or stop what they left running (#4905)`;
}

export interface ReaperStats { reaped: number; lastReaped: string[]; woken: number; swap: Swap | null; hold: number | null; at: number; heavy: string[] }

const stats: ReaperStats = { reaped: 0, lastReaped: [], woken: 0, swap: null, hold: SWAP_HOLD, at: 0, heavy: [] };
const stopped = new Set<number>();

/** What the reaper has done since the office started, for /__rb/mem. */
export const reaperStats = (): ReaperStats => ({ ...stats, hold: Number.isFinite(holdAt()) ? holdAt() : null, lastReaped: [...stats.lastReaped], heavy: [...stats.heavy] });

/** One round: wake what stays stopped, end the orphans, read the swap, and say on the floor once when swap crosses SWAP_HOLD. */
export async function reapOnce(floors: () => Iterable<ReapFloor>, toast: (message: string) => void, read: { procs: () => Proc[]; swap: () => Swap | null; heavy?: () => string[] } = { procs: processes, swap: swapUsage, heavy }) {
  const woke = stuck(floors(), stopped, read.procs()).filter((p) => { try { process.kill(p.pid, "SIGCONT"); return true; } catch { return false; } });
  stats.woken += woke.length;
  if (woke.length) toast(`Woke ${woke.length} stopped process${woke.length === 1 ? "" : "es"} of the office (state T since the last round): ${woke.slice(0, 3).map((p) => p.args.slice(0, 40)).join("; ")}`);
  const procs = read.procs();
  const found = [...new Set([...orphans(floors(), procs), ...stoppedLeftovers(procs), ...leftShells(procs)])];
  const n = await end(found.map((p) => p.pid));
  stats.reaped += n;
  if (n) {
    stats.lastReaped = found.slice(0, 10).map((p) => `${p.pid} ${p.args.slice(0, 80)} (in ${p.cwd})`);
    toast(`Ended ${n} leftover process${n === 1 ? "" : "es"}: shells and stopped sessions whose session is gone, or servers of worktrees nobody sits at (#4905, #5209)`);
  }
  const was = stats.swap?.pct ?? 0;
  stats.swap = read.swap();
  stats.at = Date.now();
  stats.heavy = stats.swap && stats.swap.pct > holdAt() ? (read.heavy?.() ?? []) : [];
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
