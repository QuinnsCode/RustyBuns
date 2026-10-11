// The office watching its own memory, over a long session, with the same memWatch the box hosts run.
//
// The office and each floor's pty host sample RSS and the JS heap every 5 minutes and fit a slope over the
// last hour, so a slow leak reads as a steady +MB/h. The office logs a [mem] line to its terminal; a pty host
// to the floor's .agent-office/pty-host.log, and it leaves its latest numbers in pty-host-mem.json beside it
// for the office to read. Signed in, /__rb/mem returns them all. The office's samples also go into
// <data>/history.jsonl with its profiles, so /__rb/history compares this run with the ones before. AGENT_OFFICE_MEM_MAX_MB sets a ceiling for
// each: over it, that process writes a V8 heap snapshot to its data dir's heap/ and exits (the pty host
// outlives an office that exits, as it does a restart). Unset, they only watch.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { memWatch, type MemStats } from "@rustybuns/shell-bun/memwatch";
import { history, type History } from "@rustybuns/shell-bun/history";

export const PTY_MEM_FILE = "pty-host-mem.json";

export interface PtyHostMem extends MemStats {
  pid: number;
  at: number;
}

const ceiling = () => Number(process.env.AGENT_OFFICE_MEM_MAX_MB) || 0;

let office: ReturnType<typeof memWatch> | undefined;
let officeHist: History | undefined;

/** The office's history (<data>/history.jsonl): a line per start, memory sample, profile and ceiling restart. */
export function officeHistory(dataDir: string): History {
  if (!officeHist) {
    officeHist = history({ file: path.join(dataDir, "history.jsonl") });
    officeHist.boot();
  }
  return officeHist;
}

export interface OfficeMem {
  office: MemStats;
  /** Each floor's pty host, null before its first sample. */
  ptyHosts: { floor: string; mem: PtyHostMem | null }[];
}

/** Start the office's watch (once) and return what /__rb/mem serves. */
export function officeMem(dataDir: string, floors: () => Iterable<{ id: string; dir: string }>): () => OfficeMem {
  if (!office) {
    const hist = officeHistory(dataDir);
    office = memWatch({
      maxMb: ceiling(), snapshotDir: path.join(dataDir, "heap"),
      onSample: (s) => hist.mem(s), beforeRestart: async (s) => hist.ceiling(s),
    });
    office.tick();
  }
  const watch = office;
  return () => ({
    office: watch.stats(),
    ptyHosts: [...floors()].map((f) => ({ floor: f.id, mem: readPtyHostMem(path.join(f.dir, ".agent-office")) })),
  });
}

/** The pty host's latest sample, or null before its first one, with no pty host, or once the one that wrote it is gone. */
export function readPtyHostMem(dataDir: string): PtyHostMem | null {
  const file = path.join(dataDir, PTY_MEM_FILE);
  if (!existsSync(file)) return null;
  let mem: PtyHostMem;
  try { mem = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  return alive(mem.pid) ? mem : null;
}

/** Whether a process is running: signal 0 checks without sending anything (EPERM means it runs as someone else). */
function alive(pid: unknown): boolean {
  if (typeof pid !== "number" || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === "EPERM"; }
}

/** The pty host's watch: its log is stderr (pty-host.log), and each sample lands next to its info file. */
export function ptyHostMem(infoPath: string | undefined, now = Date.now) {
  if (!infoPath) return undefined;
  const dataDir = path.dirname(infoPath);
  const file = path.join(dataDir, PTY_MEM_FILE);
  const write = (s: MemStats) => {
    try { writeFileSync(file, JSON.stringify({ ...s, pid: process.pid, at: now() }), { mode: 0o600 }); } catch {}
  };
  const watch = memWatch({ maxMb: ceiling(), snapshotDir: path.join(dataDir, "heap"), log: (l) => console.error(l), onSample: write });
  // an orphaned, unclaimed or stopped pty host takes its numbers with it (a killed one is caught by readPtyHostMem)
  const clear = () => {
    try { if (JSON.parse(readFileSync(file, "utf8")).pid === process.pid) rmSync(file); } catch {}
  };
  process.on("exit", clear);
  watch.tick();
  return { ...watch, stop: () => { watch.stop(); process.off("exit", clear); } };
}
