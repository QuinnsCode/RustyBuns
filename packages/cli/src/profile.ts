// Per-step wall-clock timing for the long commands (build desktop, plan, deploy).
// Every run prints a table at the end and writes .rustybuns/profile/<command>.json,
// keeping the previous run beside it, so a change shows up as a delta per step.

import { mkdir, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

export const PROFILE_DIR = ".rustybuns/profile";

export interface Step { name: string; ms: number; note?: string }
export interface ProfileRun { command: string; at: string; bun: string; totalMs: number; steps: Step[] }

export class Profiler {
  readonly steps: Step[] = [];
  private readonly t0 = performance.now();
  constructor(readonly command: string) {}

  /** Time `fn` as one step. A throwing step is still recorded, marked failed. */
  async step<T>(name: string, fn: () => T | Promise<T>, note?: string): Promise<T> {
    const t = performance.now();
    try { return await fn(); }
    catch (e) { note = note ? `${note}, failed` : "failed"; throw e; }
    finally { this.steps.push({ name, ms: performance.now() - t, ...(note ? { note } : {}) }); }
  }

  /** Attach a note to the most recent step with this name (e.g. which checker ran). */
  note(name: string, note: string) {
    const s = this.steps.findLast((x) => x.name === name);
    if (s) s.note = s.note ? `${s.note}, ${note}` : note;
  }

  run(): ProfileRun {
    return { command: this.command, at: new Date().toISOString(), bun: Bun.version, totalMs: performance.now() - this.t0, steps: this.steps };
  }

  /** Print the table (with deltas against the last run of this command) and save this run. */
  async finish(): Promise<ProfileRun> {
    const run = this.run();
    const file = `${PROFILE_DIR}/${this.command.replace(/\W+/g, "-")}.json`;
    const prev = readRun(file);
    console.log("\n" + formatProfile(run, prev));
    await mkdir(PROFILE_DIR, { recursive: true });
    if (existsSync(file)) await rename(file, file.replace(/\.json$/, ".prev.json"));
    await Bun.write(file, JSON.stringify(run, null, 2) + "\n");
    return run;
  }
}

function readRun(file: string): ProfileRun | undefined {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
}

export function fmtMs(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function delta(now: number, before?: number): string {
  if (before === undefined || before < 1) return "";
  const d = now - before;
  if (Math.abs(d) < 5) return "  =";
  const x = before / now;
  return `  ${d < 0 ? "-" : "+"}${fmtMs(Math.abs(d))}` + (x >= 1.5 ? ` (${x.toFixed(1)}x faster)` : x <= 1 / 1.5 ? ` (${(1 / x).toFixed(1)}x slower)` : "");
}

/** A step-by-step table. With `prev`, each row also shows the change since that run. */
export function formatProfile(run: ProfileRun, prev?: ProfileRun): string {
  const w = Math.max(5, ...run.steps.map((s) => s.name.length));
  const rows = run.steps.map((s) => {
    const before = prev?.steps.find((p) => p.name === s.name)?.ms;
    const pct = run.totalMs > 0 ? Math.round((s.ms / run.totalMs) * 100) : 0;
    return `  ${s.name.padEnd(w)}  ${fmtMs(s.ms).padStart(7)}  ${String(pct).padStart(3)}%${delta(s.ms, before)}${s.note ? `  [${s.note}]` : ""}`;
  });
  return [`profile: ${run.command}  (bun ${run.bun})`, ...rows, `  ${"total".padEnd(w)}  ${fmtMs(run.totalMs).padStart(7)}${delta(run.totalMs, prev?.totalMs)}`].join("\n");
}
