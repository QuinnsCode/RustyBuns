// Cron Triggers off Cloudflare. A Worker's `scheduled(controller, env, ctx)`
// runs on the edge when one of its crons fires; here a timer wakes at the top
// of every minute and fires each cron that matches it, so the same handler
// runs on the desktop and on a box. Times are UTC, as on Cloudflare.
//
// Five fields: minute hour day-of-month month day-of-week. Each is `*`, a
// number, a range `a-b`, a step `*/n` or `a-b/n`, or a list of those. Months
// and weekdays take names (JAN, MON); Sunday is 0 or 7. As in cron, when both
// day fields are restricted, a day matching either one fires.

const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] },
  { min: 0, max: 7, names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] },
] as const;

export interface Cron {
  expr: string;
  fields: Set<number>[];
  /** Whether each day field was `*`, which changes how the two combine. */
  anyDom: boolean;
  anyDow: boolean;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron "${expr}": want 5 fields (minute hour day month weekday), got ${parts.length}`);
  const fields = parts.map((part, i) => {
    const f = FIELDS[i]!;
    const num = (s: string) => {
      const n = "names" in f ? (f.names as readonly string[]).indexOf(s.toUpperCase()) : -1;
      const v = n >= 0 ? n + (i === 3 ? 1 : 0) : /^\d+$/.test(s) ? Number(s) : NaN;
      if (!(v >= f.min && v <= f.max)) throw new Error(`cron "${expr}": ${s} is out of range for field ${i + 1} (${f.min}-${f.max})`);
      return v;
    };
    const set = new Set<number>();
    for (const item of part.split(",")) {
      const [range, stepS] = item.split("/");
      const step = stepS === undefined ? 1 : Number(stepS);
      if (!(step >= 1) || !Number.isInteger(step)) throw new Error(`cron "${expr}": bad step in ${item}`);
      let lo: number, hi: number;
      if (range === "*") [lo, hi] = [f.min, f.max];
      else if (range!.includes("-")) { const [a, b] = range!.split("-"); [lo, hi] = [num(a!), num(b!)]; }
      else { lo = num(range!); hi = stepS === undefined ? lo : f.max; }
      if (lo > hi) throw new Error(`cron "${expr}": ${item} runs backwards`);
      for (let v = lo; v <= hi; v += step) set.add(i === 4 && v === 7 ? 0 : v);
    }
    return set;
  });
  return { expr, fields, anyDom: parts[2] === "*", anyDow: parts[4] === "*" };
}

/** Does `cron` fire in the UTC minute that holds `at`? */
export function cronMatches(cron: Cron, at: Date): boolean {
  const [m, h, dom, mon, dow] = cron.fields as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (!m.has(at.getUTCMinutes()) || !h.has(at.getUTCHours()) || !mon.has(at.getUTCMonth() + 1)) return false;
  const d = dom.has(at.getUTCDate()), w = dow.has(at.getUTCDay());
  return cron.anyDom || cron.anyDow ? d && w : d || w;
}

/** What `scheduled()` receives: Cloudflare's ScheduledController. */
export interface ScheduledController { cron: string; scheduledTime: number; type: "scheduled"; noRetry(): void }

/**
 * Fire `run` for each cron that matches a minute, from the next minute on,
 * until the returned stop() is called. A run that throws is reported and the
 * schedule carries on. The timer is unref'd, so it never keeps a process alive.
 */
export function schedule(crons: string[], run: (c: ScheduledController) => unknown, opts: { onError?: (err: unknown, cron: string) => void; now?: () => number } = {}): () => void {
  const parsed = crons.map(parseCron);
  const now = opts.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const tick = (minute: number) => {
    for (const c of parsed) {
      if (!cronMatches(c, new Date(minute))) continue;
      const controller: ScheduledController = { cron: c.expr, scheduledTime: minute, type: "scheduled", noRetry() {} };
      Promise.resolve().then(() => run(controller)).catch((e) => (opts.onError ?? ((err, cron) => console.error(`[cron ${cron}]`, err)))(e, c.expr));
    }
  };
  const arm = () => {
    if (stopped) return;
    const next = (Math.floor(now() / 60_000) + 1) * 60_000;
    timer = setTimeout(() => { tick(next); arm(); }, next - now());
    (timer as { unref?: () => void }).unref?.();
  };
  arm();
  return () => { stopped = true; clearTimeout(timer); };
}
