// The office watching its own memory, over a long session, with the same memWatch the box hosts run.
//
// The office and each floor's pty host sample RSS and the JS heap every 5 minutes and fit a slope over the
// last hour, so a slow leak reads as a steady +MB/h. The office logs a [mem] line to its terminal; a pty host
// to the floor's .agent-office/pty-host.log, and it leaves its latest numbers in pty-host-mem.json beside it
// for the office to read. Signed in, /__rb/mem returns them all. AGENT_OFFICE_MEM_MAX_MB sets a ceiling for
// each: over it, that process writes a V8 heap snapshot to its data dir's heap/ and exits (the pty host
// outlives an office that exits, as it does a restart). Unset, they only watch.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { memWatch, type MemStats } from "@rustybuns/shell-bun/memwatch";

export const PTY_MEM_FILE = "pty-host-mem.json";

export interface PtyHostMem extends MemStats {
  pid: number;
  at: number;
}

const ceiling = () => Number(process.env.AGENT_OFFICE_MEM_MAX_MB) || 0;

let office: ReturnType<typeof memWatch> | undefined;

export interface OfficeMem {
  office: MemStats;
  /** Each floor's pty host, null before its first sample. */
  ptyHosts: { floor: string; mem: PtyHostMem | null }[];
}

/** Start the office's watch (once) and return what /__rb/mem serves. */
export function officeMem(dataDir: string, floors: () => Iterable<{ id: string; dir: string }>): () => OfficeMem {
  if (!office) {
    office = memWatch({ maxMb: ceiling(), snapshotDir: path.join(dataDir, "heap") });
    office.tick();
  }
  const watch = office;
  return () => ({
    office: watch.stats(),
    ptyHosts: [...floors()].map((f) => ({ floor: f.id, mem: readPtyHostMem(path.join(f.dir, ".agent-office")) })),
  });
}

/** The pty host's latest sample, or null before its first one (or with no pty host). */
export function readPtyHostMem(dataDir: string): PtyHostMem | null {
  const file = path.join(dataDir, PTY_MEM_FILE);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
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
  watch.tick();
  return watch;
}
