// A .cpuprofile as an agent can read it: the frames with the most self time
// and total time, each with the stack it sat in, in a few hundred bytes
// instead of the megabytes of the profile. The flame graph stays in the file
// (Chrome DevTools > Performance, or speedscope.app); this is the gist of it.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface CallFrame { functionName: string; url: string; lineNumber: number; columnNumber?: number }
interface ProfileNode { id: number; callFrame: CallFrame; children?: number[] }
export interface CpuProfile { nodes: ProfileNode[]; startTime: number; endTime: number; samples?: number[]; timeDeltas?: number[] }

export interface HotFrame {
  /** The function's name, `(anonymous)` for one without. */
  fn: string;
  /** Where it is: the file's last two path segments and the 1-based line, empty for V8's own. */
  at: string;
  ms: number;
  pct: number;
  /** Its callers, nearest first, along the heaviest path into it (self frames only). */
  stack?: string[];
}

export interface ProfileSummary {
  durationMs: number;
  samples: number;
  /** Time with nothing to run: high means the process was waiting, not busy. */
  idlePct: number;
  gcPct: number;
  /** Most time spent in the function itself. */
  self: HotFrame[];
  /** Most time with the function anywhere on the stack. */
  total: HotFrame[];
}

/** V8's own bookkeeping frames, not code anyone wrote. */
const META = new Set(["(root)", "(program)", "(idle)"]);
const round = (n: number) => Math.round(n * 10) / 10;

function where(f: CallFrame): string {
  if (!f.url) return "";
  const path = f.url.replace(/^file:\/\//, "").split(/[\\/]/).filter(Boolean).slice(-2).join("/");
  return `${path}:${f.lineNumber + 1}`;
}
const label = (f: CallFrame) => { const at = where(f); return `${f.functionName || "(anonymous)"}${at ? ` ${at}` : ""}`; };

/** The hottest `top` frames by self and by total time. */
export function summarizeProfile(p: CpuProfile, top = 10): ProfileSummary {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const samples = p.samples ?? [], deltas = p.timeDeltas ?? [];
  const durationUs = Math.max(0, p.endTime - p.startTime);
  // A sample lasts until the next one; the last gets the average.
  const avg = samples.length ? durationUs / samples.length : 0;
  const weight = (i: number) => (i + 1 < deltas.length ? Math.max(0, deltas[i + 1]!) : avg);

  const nodeSelf = new Map<number, number>();
  const self = new Map<string, number>(), total = new Map<string, number>();
  let idle = 0, gc = 0, all = 0;
  samples.forEach((id, i) => {
    const w = weight(i);
    all += w;
    const node = byId.get(id);
    if (!node) return;
    const name = node.callFrame.functionName;
    if (name === "(idle)") idle += w;
    if (name === "(garbage collector)") gc += w;
    nodeSelf.set(id, (nodeSelf.get(id) ?? 0) + w);
    if (!META.has(name)) self.set(label(node.callFrame), (self.get(label(node.callFrame)) ?? 0) + w);
    // each function once per sample, however deep it recursed
    const seen = new Set<string>();
    for (let n: ProfileNode | undefined = node; n; n = byId.get(parent.get(n.id) ?? -1)) {
      if (META.has(n.callFrame.functionName)) continue;
      const k = label(n.callFrame);
      if (seen.has(k)) continue;
      seen.add(k);
      total.set(k, (total.get(k) ?? 0) + w);
    }
  });

  const pct = (us: number) => (all ? round((us / all) * 100) : 0);
  // the node that holds the most of a frame's self time stands for its stack
  const heaviest = new Map<string, number>();
  for (const [id, us] of nodeSelf) {
    const k = label(byId.get(id)!.callFrame);
    const best = heaviest.get(k);
    if (best === undefined || us > nodeSelf.get(best)!) heaviest.set(k, id);
  }
  const stack = (id: number) => {
    const out: string[] = [];
    for (let n = byId.get(parent.get(id) ?? -1); n && out.length < 8; n = byId.get(parent.get(n.id) ?? -1))
      if (!META.has(n.callFrame.functionName)) out.push(label(n.callFrame));
    return out;
  };
  const rank = (m: Map<string, number>, withStack: boolean): HotFrame[] =>
    [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, us]) => {
      const f = byId.get(heaviest.get(k) ?? -1)?.callFrame ?? p.nodes.find((n) => label(n.callFrame) === k)!.callFrame;
      return { fn: f.functionName || "(anonymous)", at: where(f), ms: round(us / 1000), pct: pct(us), ...(withStack && heaviest.has(k) ? { stack: stack(heaviest.get(k)!) } : {}) };
    });
  return {
    durationMs: round(durationUs / 1000), samples: samples.length, idlePct: pct(idle), gcPct: pct(gc),
    self: rank(self, true), total: rank(total, false),
  };
}

/** The summary as a few lines of text. */
export function formatProfileSummary(s: ProfileSummary): string {
  // Bun's profiler only samples while JS runs, so a process that sat waiting has none
  if (!s.samples) return "no samples: nothing ran on the JS thread while it sampled (the process was waiting, not busy)";
  const line = (f: HotFrame) => `  ${String(f.pct).padStart(5)}%  ${String(f.ms).padStart(8)}ms  ${f.fn}${f.at ? `  ${f.at}` : ""}`;
  return [
    `${s.durationMs}ms, ${s.samples} samples · idle ${s.idlePct}% · gc ${s.gcPct}%`,
    "self time:",
    ...s.self.flatMap((f) => [line(f), ...(f.stack?.length ? [`           ← ${f.stack.slice(0, 4).join(" ← ")}`] : [])]),
    "total time:",
    ...s.total.map(line),
  ].join("\n");
}

export interface SavedFile { id: string; file: string; at: string; bytes: number }

/** The files in `dir` ending in `ext`, newest first. Empty when there's no dir. */
export function listSaved(dir: string, ext: string): SavedFile[] {
  let names: string[];
  try { names = readdirSync(dir).filter((f) => f.endsWith(ext)); } catch { return []; }
  return names.map((id) => {
    const file = join(dir, id), st = statSync(file);
    return { id, file, at: st.mtime.toISOString(), bytes: st.size };
  }).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}
