// A cap on each worker's sandbox, and a floor under the volume (#2859).
//
// On 2026-10-29 the Mac's disk filled while workers ran: ~49 worktrees at 2-3 GB of node_modules each, plus per-session
// scratch folders, plus Docker. Nothing said which. Each worker's sandbox is its worktree (node_modules included) plus
// its Claude scratch folder; past a cap the office tells the owner which directories are biggest, and below a floor of
// free space on the volume it says so once. It warns and never stops anyone: until 2026-11-18 it paused workers with
// SIGSTOP, and on a nearly full disk that froze every session at once. A stopped process keeps its memory, so it is
// pushed out to swap files on the same full disk (19.9 of 20 GB), it frees no space, and the SIGHUP or SIGTERM that
// should end it when its worker is sent home or replaced waits until a SIGCONT that never came: about 90 sessions sat
// stopped for up to 6 days. The reaper now wakes anything of the office's that stays stopped (live/reaper.ts).
//   AGENT_OFFICE_SANDBOX_CAP_GB   per worker, default 8 (0 turns the cap off)
//   AGENT_OFFICE_DISK_FLOOR_GB    free on the volume, default 15 (0 turns the floor off)
//   AGENT_OFFICE_STORAGE_SCAN_S   seconds between looks, default 120
import { execFile } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { every } from "./every.ts";

const GB = 1024 ** 3;
/** A worker over the cap is clear again once it's this far under it, so one that hovers at the line isn't announced every look. */
export const RESUME_AT = 0.95;

export interface Settings {
  capBytes: number;
  floorBytes: number;
  everyMs: number;
}

type Vars = Record<string, string | undefined>;

export function settings(vars: Vars = process.env): Settings {
  const gb = (name: string, dflt: number) => {
    const raw = vars[name];
    const n = Number(raw);
    return raw === undefined || raw === "" || !Number.isFinite(n) || n < 0 ? dflt : n;
  };
  return {
    capBytes: gb("AGENT_OFFICE_SANDBOX_CAP_GB", 8) * GB,
    floorBytes: gb("AGENT_OFFICE_DISK_FLOOR_GB", 15) * GB,
    everyMs: Math.max(10, gb("AGENT_OFFICE_STORAGE_SCAN_S", 120)) * 1000,
  };
}

export interface Size {
  bytes: number;
  /** The biggest directories under it, biggest first. */
  top: { path: string; bytes: number }[];
}

/** Where Claude Code keeps a session's scratch for a worker started in `cwd` (its slug is the path with / and . as -). */
export function scratchOf(cwd: string, uid = process.getuid?.() ?? 0, base = process.platform === "darwin" ? "/private/tmp" : "/tmp") {
  return path.join(base, `claude-${uid}`, cwd.replace(/[/.]/g, "-"));
}

/**
 * The sandbox's size on disk (blocks, not apparent bytes; a hardlink counts once across all of `roots`), without .git,
 * with the biggest directories one level under each root. One `du` child does the walk: until #6199 the server awaited
 * an lstat per file over every seated worktree, and that kept its JS thread 55-59% busy.
 */
export async function sizeOf(roots: string[], topN = 5, platform = process.platform): Promise<Size> {
  const there = roots.filter((r) => existsSync(r));
  if (!there.length) return { bytes: 0, top: [] };
  const skipGit = platform === "darwin" || platform.endsWith("bsd") ? ["-I", ".git"] : ["--exclude=.git"];
  // du exits 1 when it can't read a file somewhere (a worker deleting as it walks); what it printed still counts.
  const out = await new Promise<string>((done) =>
    execFile("du", ["-k", "-d", "1", ...skipGit, ...there], { maxBuffer: 16 << 20, timeout: 10 * 60_000 }, (_err, stdout) => done(String(stdout ?? ""))));
  const rows = out.split("\n").flatMap((line) => {
    const tab = line.indexOf("\t");
    const kb = Number(line.slice(0, tab));
    return tab > 0 && Number.isFinite(kb) ? [{ path: line.slice(tab + 1), bytes: kb * 1024 }] : [];
  });
  const isRoot = (p: string) => there.some((r) => path.resolve(r) === path.resolve(p));
  return {
    bytes: rows.filter((r) => isRoot(r.path)).reduce((n, r) => n + r.bytes, 0),
    top: rows.filter((r) => !isRoot(r.path)).sort((a, b) => b.bytes - a.bytes).slice(0, topN),
  };
}

export interface Seat {
  id: string;
  name: string;
  pid: number | undefined;
  cwd: string;
}

export interface Deps {
  seats: () => Seat[];
  /** Bytes of a worker's sandbox: worktree plus scratch, with the biggest directories in it. */
  sizeOf: (seat: Seat) => Promise<Size>;
  free: () => number;
  alert: (text: string) => void;
  settings: () => Settings;
}

const gb = (b: number) => `${(b / GB).toFixed(1)} GB`;
const short = (p: string) => p.replace(homedir(), "~");

/** One floor's guard: each look names the workers over the cap and a volume under the floor, once each, and never stops a process. */
export class StorageGuard {
  /** The workers over the cap now. */
  readonly over = new Set<string>();
  private low = false;
  private halt?: () => void;

  constructor(private d: Deps) {}

  start() {
    this.halt = every(this.d.settings().everyMs, () => this.look(), { name: "storage guard", first: 0 });
  }
  stop() { this.halt?.(); }

  /** One look: the workers over the cap now, and the volume against its floor. */
  async look() {
    const { capBytes, floorBytes } = this.d.settings();
    const seats = this.d.seats();
    const free = this.d.free();
    const low = floorBytes > 0 && free < floorBytes;
    if (low && !this.low)
      this.d.alert(`💾 Only ${gb(free)} free on the disk (floor ${gb(floorBytes)}): clear space before it fills: office-workers home --merged, bun caches, Docker, old worktrees`);
    this.low = low;
    for (const id of [...this.over]) if (!seats.some((s) => s.id === id)) this.over.delete(id);
    for (const seat of seats) {
      const had = this.over.has(seat.id);
      if (capBytes <= 0) { this.over.delete(seat.id); continue; }
      const size = await this.d.sizeOf(seat);
      const over = size.bytes > (had ? capBytes * RESUME_AT : capBytes);
      if (over && !had) {
        const top = size.top.map((t) => `${short(t.path)} ${gb(t.bytes)}`).join("; ");
        this.d.alert(`💾 ${seat.name}'s sandbox is ${gb(size.bytes)}, over the ${gb(capBytes)} cap. Biggest: ${top || "n/a"}. Clear space or raise AGENT_OFFICE_SANDBOX_CAP_GB`);
      }
      if (over) this.over.add(seat.id);
      else this.over.delete(seat.id);
    }
  }
}

/** The guard wired to a floor: its workers' ptys, its toast, the volume `dir` is on. */
export function storageGuard(
  floor: {
    id: string;
    ctx: { toast: (floor: unknown, text: string, level?: string) => void };
    workers: { owners(): { workerId: string; pid?: number; cwd: string }[]; get(id: string): { name: string } | undefined };
  },
  dir: string,
  _dataDir?: string,
  vars: Vars = process.env,
) {
  const guard = new StorageGuard({
    seats: () => floor.workers.owners().map((o) => ({ id: o.workerId, name: floor.workers.get(o.workerId)?.name ?? o.workerId, pid: o.pid, cwd: o.cwd })),
    sizeOf: (seat) => sizeOf([seat.cwd, scratchOf(seat.cwd)]),
    free: () => { try { const s = statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; } },
    alert: (text) => floor.ctx.toast(floor, text, "warn"),
    settings: () => settings(vars),
  });
  guard.start();
  return guard;
}
