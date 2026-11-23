import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { endIn, parseHeavy, parseSwap, processes, reapOnce, reaperStats, swapHold } from "../live/reaper.ts";
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
/**
 * The machine's processes as the reaper sees them, with ours under pid 1 (a CI runner may hand orphans to a subreaper)
 * and every other orphan's parent hidden, so a test round never ends a real leftover on the machine it runs on.
 */
const ours = () => processes().map((p) => (started.includes(p.pid) ? { ...p, ppid: 1 } : p.ppid === 1 ? { ...p, ppid: 0 } : p));
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
  const procs = ours;
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
  const procs = () => processes().map((p) => (p.pid in ppid ? { ...p, ppid: ppid[p.pid]!, cwd: "" } : p.ppid === 1 ? { ...p, ppid: 0 } : p));
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
  // what holds it, said plainly, from a Mac's top
  const big = parseHeavy("COMMAND          MEM\nfseventsd        27G\ncom.apple.Virtua 8206M\nGoogle Chrome He 1730M+\n");
  expect(big).toEqual(["fseventsd (macOS's file watcher: a restart clears it) 27G", "Docker's VM (quit Docker Desktop) 8206M", "Google Chrome He 1730M"]);
  expect(swapHold(parseSwap(rows[0]![0]), big)).toContain("Most of it: fseventsd");
});

test("the reaper ends a server left in a gone worktree's scratch folder, and a Claude Code shell whose session is gone, with its loop", async () => {
  // the office's worktrees folder as a session's scratch key: every character but letters and digits a -
  const key = path.join(realpathSync(repo), WORKTREES).replace(/[^A-Za-z0-9]/g, "-");
  const scratch = (name: string) => { const d = path.join(repo, "tmp", "claude-501", `${key}-${name}`, "session", "scratchpad"); mkdirSync(d, { recursive: true }); return d; };
  tree("gizmo-6"); tree("pixel-7");
  const [server, kept] = [leave(scratch("gizmo-6")), leave(scratch("pixel-7"))];
  // a watch loop's shell, as Claude Code starts one; its session ended, so it sits under pid 1
  const shell = Bun.spawn(["/bin/sh", "-c", "source /nowhere/.claude/shell-snapshots/snap.sh 2>/dev/null || true; while true; do sleep 30; done"], { stdout: "ignore", stderr: "ignore" });
  started.push(shell.pid);
  await Bun.sleep(300);
  const floor = { dir: repo, workers: { list: () => [{ worktree: { path: path.join(WORKTREES, "pixel-7") } }] } };
  const procs = ours;
  const n = await reapOnce(() => [floor], () => {}, { procs, swap: () => null });
  expect({ server: alive(server), shell: alive(shell.pid), kept: alive(kept) }).toEqual({ server: false, shell: false, kept: true });
  expect(n).toBeGreaterThanOrEqual(3); // the server, the shell and the sleep under it
});
