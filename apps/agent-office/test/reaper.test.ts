import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { endWorker, OLD_ORPHAN_S, parseEtime, parseHeavy, parseSwap, processes, type Proc, reapOnce, reaperStats, swapHold } from "../live/reaper.ts";
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

test("sending a worker home ends what runs in each of its worktrees, subfolders too, and nothing else", async () => {
  // a worker across repositories: this floor's worktree and another repo's, side by side in its workspace
  const mine = tree("byte-1/RustyBuns"), mineToo = tree("byte-1/qcrm"), other = tree("nibble-2");
  mkdirSync(path.join(mine, "apps/x"), { recursive: true });
  const [dev, vite, api, theirs] = [leave(mine), leave(path.join(mine, "apps/x")), leave(mineToo), leave(other)];
  expect(await endWorker([mine, mineToo])).toBe(3);
  expect([alive(dev), alive(vite), alive(api), alive(theirs)]).toEqual([false, false, false, true]);
  process.kill(theirs, "SIGKILL"); // else it is a deskless orphan for the reaper below
});

test("sending home a worker with no worktree ends what its session started, not what others left in the checkout", async () => {
  // its session leads its own process group, as a pty's child does; what it backgrounds stays in that group
  const session = Bun.spawn(["sh", "-c", "sleep 120 >/dev/null 2>&1 & echo $!"], { cwd: repo, stdout: "pipe", detached: true });
  const server = Number((await new Response(session.stdout).text()).trim());
  started.push(server);
  await session.exited;
  const someoneElses = leave(repo);
  expect(await endWorker([], session.pid)).toBe(1);
  expect([alive(server), alive(someoneElses)]).toEqual([false, true]);
  process.kill(someoneElses, "SIGKILL");
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
  process.kill(kept, "SIGKILL"); // else it is a deskless orphan for the reaper below
});

test("a seated worker's orphan a day old is an earlier session's leftover and ends; a younger one is kept", async () => {
  const seat = tree("widget-8");
  const [stale, demo] = [leave(seat), leave(seat)];
  const floor = { dir: repo, workers: { list: () => [{ worktree: { path: path.join(WORKTREES, "widget-8") } }] } };
  const procs = () => ours().map((p) => (p.pid === stale ? { ...p, age: OLD_ORPHAN_S + 60 } : p));
  expect(await reapOnce(() => [floor], () => {}, { procs, swap: () => null })).toBe(1);
  expect([alive(stale), alive(demo)]).toEqual([false, true]);
  process.kill(demo, "SIGKILL");
  // ps's elapsed time, as the age is read
  expect(["05:09", "03:05:09", "2-03:05:09"].map(parseEtime)).toEqual([309, 11_109, 183_909]);
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
  expect(await endWorker([seat])).toBe(1);
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
  // the sandbox box comes back after every restart, so a hold while it is up says how to stop it
  expect(swapHold(parseSwap(rows[0]![0]), [], true)).toContain("`bun run office:box down`");
  expect(swapHold(parseSwap(rows[0]![0]), [], false)).not.toContain("office:box");
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

test("a seated worker's fork loop, or a branch past the memory cap, is ended and named to the floor and the worker; its session is kept", async () => {
  const seat = tree("gadget-9");
  const told: string[] = [];
  const floor = { dir: repo, workers: { list: () => [{ id: "w9", name: "Gadget", worktree: { path: path.join(WORKTREES, "gadget-9") } }], prompt: (id: string, text: string) => { told.push(`${id} ${text}`); return undefined; } } };
  // the worker's session (a bun named claude: a multicall coreutils, as Ubuntu 26.04's, runs by its name and would
  // not start as `claude`), and a loop it started that keeps forking one command
  const bin = path.join(repo, "session-bin");
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, path.join(bin, "claude"));
  const claude = Bun.spawn([path.join(bin, "claude"), "-e", "setTimeout(() => {}, 120_000)"], { cwd: seat, stdio: ["ignore", "ignore", "ignore"] }).pid;
  const loop = Bun.spawn(["sh", "-c", "i=0; while [ $i -lt 150 ]; do sleep 60 & i=$((i+1)); done; wait"], { cwd: seat, stdio: ["ignore", "ignore", "ignore"] }).pid;
  started.push(claude, loop);
  const copies = () => processes().filter((p) => p.ppid === loop && p.args === "sleep 60").map((p) => p.pid);
  for (let t = 0; copies().length < 150 && t < 50; t++) await Bun.sleep(100);
  const forks = copies();
  // every other orphan on the machine hidden, as above
  const hide = (p: Proc) => (p.ppid === 1 ? { ...p, ppid: 0 } : p);
  const said: string[] = [];
  await reapOnce(() => [floor], (m) => said.push(m), { procs: () => processes().map(hide), swap: () => null });
  expect({ loop: alive(loop), forks: forks.filter(alive).length, claude: alive(claude) }).toEqual({ loop: false, forks: 0, claude: true });
  expect(said.join("\n")).toContain("Runaway in Gadget: 150 copies of `sleep 60`");
  expect(told[0]).toStartWith("w9 The office ended 151 of your processes");
  expect(reaperStats().runaways[0]).toContain("Gadget: 150 copies");

  // memory: a dev server at 9 GB goes, the session at 9 GB too stays (ending it is the worker's own call)
  const server = leave(seat);
  const big = (p: Proc) => (p.pid === server || p.pid === claude ? { ...p, rss: 9 * 1024 ** 2 } : p);
  told.length = 0;
  await reapOnce(() => [floor], (m) => said.push(m), { procs: () => processes().map(hide).map(big), swap: () => null });
  expect({ server: alive(server), claude: alive(claude) }).toEqual({ server: false, claude: true });
  expect(told[0]).toContain("9.0 GB in all, over 8.0 GB");
  process.kill(claude, "SIGKILL");
});
