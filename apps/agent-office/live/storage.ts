// A cap on each worker's sandbox, and a floor under the volume (#2859).
//
// On 2026-10-29 the Mac's disk filled while workers ran: ~49 worktrees at 2-3 GB of node_modules each, plus per-session
// scratch folders, plus Docker. Nothing said which. Each worker's sandbox is its worktree (node_modules included) plus
// its Claude scratch folder; past a cap the office pauses that worker (SIGSTOP: it stays at its desk, nothing is lost)
// and tells the owner which directories are biggest. Below a floor of free space on the volume every worker pauses,
// since no one worker can fix that. Both resume by themselves once the owner clears space or raises the cap.
//   AGENT_OFFICE_SANDBOX_CAP_GB   per worker, default 8 (0 turns the cap off)
//   AGENT_OFFICE_DISK_FLOOR_GB    free on the volume, default 15 (0 turns the floor off)
//   AGENT_OFFICE_STORAGE_SCAN_S   seconds between looks, default 120
import { existsSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const GB = 1024 ** 3;
/** node_modules is most of the bytes and changes least: it's sized again after this long. */
export const NODE_MODULES_MS = 15 * 60_000;
/** A paused worker resumes once it's this far under the cap, so one that hovers at the line isn't stopped and started every look. */
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

/** A tree's size on disk (blocks, not apparent bytes; a hardlink counts once), without .git, and a node_modules from memory while it's fresh. */
export class Sizer {
  private nm = new Map<string, { bytes: number; at: number }>();
  constructor(private now = Date.now) {}

  async size(root: string, topN = 5): Promise<Size> {
    const seen = new Set<string>();
    const dirs: { path: string; bytes: number }[] = [];
    const walk = async (dir: string, depth: number): Promise<number> => {
      const isNm = path.basename(dir) === "node_modules";
      if (isNm) {
        const hit = this.nm.get(dir);
        if (hit && this.now() - hit.at < NODE_MODULES_MS) return hit.bytes;
      }
      let total = 0;
      let entries: import("node:fs").Dirent[];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return 0; }
      for (const e of entries) {
        if (e.name === ".git") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { total += await walk(p, depth + 1); continue; }
        try {
          const s = await lstat(p);
          if (s.nlink > 1) {
            const key = `${s.dev}:${s.ino}`;
            if (seen.has(key)) continue;
            seen.add(key);
          }
          total += s.blocks * 512;
        } catch {}
      }
      if (isNm) this.nm.set(dir, { bytes: total, at: this.now() });
      if (depth === 1) dirs.push({ path: dir, bytes: total });
      return total;
    };
    const bytes = await walk(root, 0);
    return { bytes, top: dirs.sort((a, b) => b.bytes - a.bytes).slice(0, topN) };
  }
}

export interface Seat {
  id: string;
  name: string;
  pid: number | undefined;
  cwd: string;
}

export type Why = "cap" | "volume";

export interface Deps {
  seats: () => Seat[];
  /** Bytes of a worker's sandbox: worktree plus scratch, with the biggest directories in it. */
  sizeOf: (seat: Seat) => Promise<Size>;
  free: () => number;
  pause: (seat: Seat) => void;
  resume: (seat: Seat) => void;
  alert: (text: string) => void;
  settings: () => Settings;
  /** The paused workers survive an office restart: a stopped process stays stopped. */
  load: () => string[];
  save: (ids: string[]) => void;
}

const gb = (b: number) => `${(b / GB).toFixed(1)} GB`;
const short = (p: string) => p.replace(homedir(), "~");

/** One floor's guard: each look pauses workers over the cap (all of them, under the floor), resumes those that are clear, and says so once. */
export class StorageGuard {
  readonly paused = new Map<string, Why>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private looking = false;

  constructor(private d: Deps) {
    for (const id of d.load()) this.paused.set(id, "cap");
  }

  start() {
    void this.look();
    this.timer = setInterval(() => void this.look(), this.d.settings().everyMs);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); }

  async look() {
    if (this.looking) return;
    this.looking = true;
    try { await this.once(); } finally { this.looking = false; }
  }

  private async once() {
    const { capBytes, floorBytes } = this.d.settings();
    const seats = this.d.seats();
    const free = this.d.free();
    const volumeLow = floorBytes > 0 && free < floorBytes;
    if (volumeLow && ![...this.paused.values()].includes("volume"))
      this.d.alert(`💾 Only ${gb(free)} free on the disk (floor ${gb(floorBytes)}): every worker is paused until space is cleared`);
    for (const id of [...this.paused.keys()]) if (!seats.some((s) => s.id === id)) this.paused.delete(id);
    for (const seat of seats) {
      const had = this.paused.get(seat.id);
      let why: Why | undefined = volumeLow ? "volume" : undefined;
      let size: Size | undefined;
      if (!why && capBytes > 0) {
        size = await this.d.sizeOf(seat);
        if (size.bytes > (had ? capBytes * RESUME_AT : capBytes)) why = "cap";
      }
      if (why && !had) {
        this.d.pause(seat);
        if (size && why === "cap") {
          const top = size.top.map((t) => `${short(t.path)} ${gb(t.bytes)}`).join("; ");
          this.d.alert(`💾 ${seat.name}'s sandbox is ${gb(size.bytes)}, over the ${gb(capBytes)} cap: paused, not sent home. Biggest: ${top || "n/a"}. Clear space or raise AGENT_OFFICE_SANDBOX_CAP_GB and it resumes`);
        }
      } else if (!why && had) {
        this.d.resume(seat);
        this.d.alert(`💾 ${seat.name} is running again`);
      }
      if (why) this.paused.set(seat.id, why);
      else this.paused.delete(seat.id);
    }
    this.d.save([...this.paused.keys()]);
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
  dataDir: string,
  vars: Vars = process.env,
) {
  const sizer = new Sizer();
  const file = path.join(dataDir, `storage-paused-${floor.id}.json`);
  const signal = (seat: Seat, sig: NodeJS.Signals) => {
    if (!seat.pid) return;
    // the worker's terminal is a session leader, so its group is its whole process tree; else the one process
    try { process.kill(-seat.pid, sig); } catch { try { process.kill(seat.pid, sig); } catch {} }
  };
  const guard = new StorageGuard({
    seats: () => floor.workers.owners().map((o) => ({ id: o.workerId, name: floor.workers.get(o.workerId)?.name ?? o.workerId, pid: o.pid, cwd: o.cwd })),
    sizeOf: async (seat) => {
      const [tree, scratch] = await Promise.all([sizer.size(seat.cwd), sizer.size(scratchOf(seat.cwd))]);
      return { bytes: tree.bytes + scratch.bytes, top: [...tree.top, ...scratch.top].sort((a, b) => b.bytes - a.bytes).slice(0, 5) };
    },
    free: () => { try { const s = statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; } },
    pause: (seat) => signal(seat, "SIGSTOP"),
    resume: (seat) => signal(seat, "SIGCONT"),
    alert: (text) => floor.ctx.toast(floor, text, "warn"),
    settings: () => settings(vars),
    load: () => { try { const v: unknown = JSON.parse(readFileSync(file, "utf8")); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } },
    save: (ids) => { try { if (ids.length || existsSync(file)) writeFileSync(file, JSON.stringify(ids)); } catch {} },
  });
  guard.start();
  return guard;
}
