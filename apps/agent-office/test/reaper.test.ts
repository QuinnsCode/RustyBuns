import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { endIn, parseSwap, processes, reapOnce, reaperStats, swapHold } from "../live/reaper.ts";
import { WORKTREES } from "../live/sweep.ts";

setDefaultTimeout(30_000);

const repo = mkdtempSync(path.join(tmpdir(), "reaper-"));
const tree = (name: string) => { const d = path.join(repo, WORKTREES, name); mkdirSync(d, { recursive: true }); return d; };
const started: number[] = [];
/** A `sleep` left running in `dir` after the shell that started it exits, as a dev server a worker backgrounded is. */
const leave = (dir: string) => {
  const pid = Number(Bun.spawnSync(["sh", "-c", "sleep 120 >/dev/null 2>&1 & echo $!"], { cwd: dir }).stdout.toString().trim());
  started.push(pid);
  return pid;
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

afterAll(() => {
  for (const p of started) try { process.kill(p, "SIGKILL"); } catch {}
  rmSync(repo, { recursive: true, force: true });
});

test("sending a worker home ends what runs in its worktree, subfolders too, and nothing else", async () => {
  const mine = tree("byte-1"), other = tree("nibble-2");
  mkdirSync(path.join(mine, "apps/x"), { recursive: true });
  const [dev, vite, theirs] = [leave(mine), leave(path.join(mine, "apps/x")), leave(other)];
  expect(await endIn(mine)).toBe(2);
  expect([alive(dev), alive(vite), alive(theirs)]).toEqual([false, false, true]);
  process.kill(theirs, "SIGKILL"); // else it is a deskless orphan for the reaper below
});

test("the reaper ends orphans of gone and deskless worktrees, keeps a seated worker's, and says when swap is over 80%", async () => {
  const seated = tree("pixel-3"), deskless = tree("chip-4"), gone = tree("bolt-5");
  const [kept, idle, lost] = [leave(seated), leave(deskless), leave(gone)];
  rmSync(gone, { recursive: true });
  const floor = { dir: repo, workers: { list: () => [{ worktree: { path: path.join(WORKTREES, "pixel-3") } }] } };
  // a CI runner may hand orphans to a subreaper rather than pid 1, so ours count as pid 1's
  const procs = () => processes().map((p) => (started.includes(p.pid) ? { ...p, ppid: 1 } : p));
  const said: string[] = [];
  const n = await reapOnce(() => [floor], (m) => said.push(m), { procs, swap: () => ({ usedMb: 22_000, totalMb: 24_576, pct: 90 }) });
  expect(n).toBe(2);
  expect([alive(kept), alive(idle), alive(lost)]).toEqual([true, false, false]);
  expect(reaperStats()).toMatchObject({ reaped: 2, swap: { pct: 90 } });
  expect(said.join("\n")).toContain("Ended 2 leftover processes");
  expect(said.join("\n")).toContain("no new hires");
});

test("a seated worker's session left stopped is woken on the second round, and a stopped one is ended without waiting for KILL", async () => {
  const seat = tree("sprocket-6");
  const floor = { dir: repo, workers: { list: () => [{ worktree: { path: path.join(WORKTREES, "sprocket-6") } }] } };
  const stat = (pid: number) => Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]).stdout.toString().trim();
  const session = leave(seat);
  process.kill(session, "SIGSTOP");
  const swap = () => null;
  await reapOnce(() => [floor], () => {}, { procs: processes, swap });
  expect(stat(session)).toStartWith("T"); // one round could be a person's ctrl-Z
  const said: string[] = [];
  await reapOnce(() => [floor], (m) => said.push(m), { procs: processes, swap });
  expect(stat(session)).not.toStartWith("T");
  expect(said.join("\n")).toContain("Woke 1 stopped process");
  expect(reaperStats().woken).toBe(1);

  process.kill(session, "SIGSTOP");
  const t0 = Date.now();
  expect(await endIn(seat)).toBe(1);
  expect(alive(session)).toBe(false);
  expect(Date.now() - t0).toBeLessThan(1500);
});

test("the reaper wakes and ends stopped claude sessions an old office left, with their children, wherever they sit", async () => {
  // a claude whose office is gone: parent pid 1, stopped, and lsof gives it no working directory
  const bin = path.join(repo, "bin");
  mkdirSync(bin, { recursive: true });
  const named = (name: string) => { const p = path.join(bin, name); symlinkSync(Bun.which("sleep")!, p); return p; };
  const spawnStopped = (file: string) => {
    const pid = Bun.spawn([file, "120"], { stdio: ["ignore", "ignore", "ignore"] }).pid;
    started.push(pid);
    process.kill(pid, "SIGSTOP");
    return pid;
  };
  const [claude, caffeinate, other] = [spawnStopped(named("claude")), spawnStopped(named("caffeinate")), spawnStopped(Bun.which("sleep")!)];
  const ppid: Record<number, number> = { [claude]: 1, [caffeinate]: claude, [other]: 1 };
  const procs = () => processes().map((p) => (p.pid in ppid ? { ...p, ppid: ppid[p.pid]!, cwd: "" } : p));
  const n = await reapOnce(() => [], () => {}, { procs, swap: () => null });
  expect(n).toBe(2);
  expect([alive(claude), alive(caffeinate), alive(other)]).toEqual([false, false, true]);
});

test("swap is read from a Mac's sysctl or Linux's meminfo, and only over 80% holds a hire", () => {
  const rows: [string, number | null][] = [
    ["total = 24576.00M  used = 23200.00M  free = 1376.00M  (encrypted)", 94],
    ["total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)", 25],
    ["total = 0.00M  used = 0.00M  free = 0.00M", null],
    ["MemTotal: 16000000 kB\nSwapTotal:       4194304 kB\nSwapFree:         419430 kB\n", 90],
  ];
  for (const [text, pct] of rows) expect(parseSwap(text)?.pct ?? null).toBe(pct);
  expect(swapHold(parseSwap(rows[0]![0]))).toContain("no new hires");
  expect(swapHold(parseSwap(rows[1]![0]))).toBeUndefined();
});
