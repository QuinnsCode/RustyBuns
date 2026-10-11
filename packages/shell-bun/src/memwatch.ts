// Memory watch for a long-lived host (a box). Every few minutes it samples RSS
// and the JS heap, keeps the last hour, and fits a line through the RSS so a
// slow leak shows up as MB per hour long before it bites. /__rb/mem serves the
// numbers. With a ceiling set, crossing it writes a V8 heap snapshot to the
// data dir (open it in Chrome DevTools > Memory, or diff two of them) and exits
// non-zero, so Railway or systemd restarts the box before the OOM killer does.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface MemSample { at: number; rss: number; heap: number }

export interface MemStats {
  rssMb: number;
  heapMb: number;
  peakRssMb: number;
  uptimeS: number;
  /** Least-squares slope of RSS over the window, MB per hour. null until 3 samples. */
  slopeMbPerHour: number | null;
  /** At that slope, hours until the ceiling. null with no ceiling or no growth. */
  hoursToMax: number | null;
  maxMb: number | null;
  samples: number;
}

export interface MemWatchOptions {
  /** @default 5 minutes */
  everyMs?: number;
  /** Samples the slope is fitted over. @default 12 (an hour at 5 minutes) */
  window?: number;
  /** RSS ceiling in MB: snapshot and exit above it. 0 or unset: watch only. */
  maxMb?: number;
  /** Where the heap snapshot goes. Unset: no snapshot. */
  snapshotDir?: string;
  log?: (line: string) => void;
  /** Called with the stats after every sample, e.g. to hand them to another process. */
  onSample?: (stats: MemStats) => void;
  exit?: (code: number) => void;
  sample?: () => { rss: number; heap: number };
  now?: () => number;
}

const MB = 2 ** 20;
const round = (n: number) => Math.round(n * 10) / 10;

/** Slope of y over x in units per ms, by least squares. */
export function slope(points: { at: number; rss: number }[]): number | null {
  if (points.length < 3) return null;
  const n = points.length, mx = points.reduce((s, p) => s + p.at, 0) / n, my = points.reduce((s, p) => s + p.rss, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.at - mx) * (p.rss - my); den += (p.at - mx) ** 2; }
  return den === 0 ? null : num / den;
}

export function memWatch(o: MemWatchOptions = {}) {
  const everyMs = o.everyMs ?? 5 * 60_000, window = o.window ?? 12, maxMb = o.maxMb || 0;
  const log = o.log ?? ((l) => console.log(l)), exit = o.exit ?? ((c) => process.exit(c));
  const now = o.now ?? Date.now;
  const sample = o.sample ?? (() => { const m = process.memoryUsage(); return { rss: m.rss, heap: m.heapUsed }; });
  const t0 = now(), samples: MemSample[] = [];
  let peak = 0, tripped = false;

  function stats(): MemStats {
    const last = samples.at(-1) ?? { at: now(), ...sample() };
    const s = slope(samples), perHour = s === null ? null : s * 3_600_000 / MB;
    const rssMb = last.rss / MB;
    return {
      rssMb: round(rssMb), heapMb: round(last.heap / MB), peakRssMb: round(Math.max(peak, last.rss) / MB),
      uptimeS: Math.round((now() - t0) / 1000), slopeMbPerHour: perHour === null ? null : round(perHour),
      hoursToMax: maxMb && perHour && perHour > 0 ? round(Math.max(0, maxMb - rssMb) / perHour) : null,
      maxMb: maxMb || null, samples: samples.length,
    };
  }

  function tick() {
    const s = { at: now(), ...sample() };
    samples.push(s);
    if (samples.length > window) samples.shift();
    peak = Math.max(peak, s.rss);
    const st = stats();
    log(`[mem] rss ${st.rssMb}MB heap ${st.heapMb}MB peak ${st.peakRssMb}MB` +
      (st.slopeMbPerHour === null ? "" : ` ${st.slopeMbPerHour >= 0 ? "+" : ""}${st.slopeMbPerHour}MB/h`) +
      (st.hoursToMax === null ? "" : ` ~${st.hoursToMax}h to ${maxMb}MB`));
    o.onSample?.(st);
    if (maxMb && st.rssMb > maxMb && !tripped) {
      tripped = true;
      log(`[mem] rss ${st.rssMb}MB over the ${maxMb}MB ceiling: restarting`);
      if (o.snapshotDir) {
        try {
          mkdirSync(o.snapshotDir, { recursive: true });
          const file = join(o.snapshotDir, `heap-${new Date(s.at).toISOString().replace(/[:.]/g, "-")}.heapsnapshot`);
          Bun.write(file, Bun.generateHeapSnapshot("v8")).then(() => log(`[mem] heap snapshot ${file}`))
            .finally(() => exit(1));
        } catch (err) { log(`[mem] heap snapshot failed: ${(err as Error).message}`); exit(1); }
      } else exit(1);
    }
  }

  const timer = setInterval(tick, everyMs);
  (timer as any).unref?.();
  return { stats, tick, stop: () => clearInterval(timer) };
}
