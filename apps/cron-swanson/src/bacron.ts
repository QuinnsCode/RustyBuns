// bacron: Cron Swanson's engine. A cadence is when a job runs ("daily at 09:00", "every 15 min", a cron line);
// `next` says the first minute after a moment that it runs, on the job's own wall clock (its time zone), and
// `flow` sorts it into the five lanes the page shows: async, daily, weekly, monthly, yearly.
// Pure: no clock, no storage. The ticker (ticker.ts) asks it once a minute.
import { Bad, arr, int, obj, oneOf, str, type Guard } from "@rustybuns/util/guard";

export const FLOWS = ["async", "daily", "weekly", "monthly", "yearly"] as const;
export type Flow = (typeof FLOWS)[number];

export type Cadence =
  | { kind: "once"; at: string } // wall time "2026-11-20T09:00"
  | { kind: "every"; minutes: number } // from the job's anchor (when it was made)
  | { kind: "daily"; time: string } // "09:00"
  | { kind: "weekly"; time: string; days: number[] } // 0 = Sunday
  | { kind: "monthly"; time: string; day: number } // 1..31; a short month runs on its last day. -1 = always the last day
  | { kind: "yearly"; time: string; month: number; day: number } // Feb 29 runs on Feb 28 in other years
  | { kind: "cron"; expr: string }; // five fields, or @daily and friends

const KINDS = ["once", "every", "daily", "weekly", "monthly", "yearly", "cron"] as const;
const HHMM = str(5, { re: /^([01]\d|2[0-3]):[0-5]\d$/ });
const MINUTE = 60_000;
const DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const SHAPES: { [K in Cadence["kind"]]: Guard<Extract<Cadence, { kind: K }>> } = {
  once: obj({ kind: oneOf(["once"]), at: str(16, { re: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/ }) }),
  every: obj({ kind: oneOf(["every"]), minutes: int(1, 527_040) }),
  daily: obj({ kind: oneOf(["daily"]), time: HHMM }),
  weekly: obj({ kind: oneOf(["weekly"]), time: HHMM, days: arr(int(0, 6), 7, { min: 1 }) }),
  monthly: obj({ kind: oneOf(["monthly"]), time: HHMM, day: int(-1, 31) }),
  yearly: obj({ kind: oneOf(["yearly"]), time: HHMM, month: int(1, 12), day: int(1, 31) }),
  cron: obj({ kind: oneOf(["cron"]), expr: str(100) }),
};

/** A cadence from the wire: the shape of its kind, and a date that exists. */
export const Cadence: Guard<Cadence> = (v) => {
  const { kind } = obj({ kind: oneOf(KINDS) })(v);
  const c: Cadence = SHAPES[kind](v);
  if (c.kind === "monthly" && c.day === 0) throw new Bad("a day from 1 to 31, or -1 for the last day", ["day"]);
  if (c.kind === "yearly" && c.day > DIM[c.month - 1]!) throw new Bad("a day that month has", ["day"]);
  if (c.kind === "once" && Number(c.at.slice(8, 10)) > daysIn(Number(c.at.slice(0, 4)), Number(c.at.slice(5, 7)))) throw new Bad("a date that exists", ["at"]);
  if (c.kind === "weekly") c.days = [...new Set(c.days)].sort();
  if (c.kind === "cron") parseCron(c.expr);
  return c;
};

/** A time zone the runtime knows ("Europe/London", "UTC"). */
export const Zone: Guard<string> = (v) => {
  const tz = str(64)(v);
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { throw new Bad("a time zone like Europe/London"); }
  return tz;
};

// ---- cron lines ----

interface Fields { min: number[]; hour: number[]; dom: number[] | null; month: number[] | null; dow: number[] | null }

const ALIASES: Record<string, string> = { "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *" };
const NAMES: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const FIELD = [["minute", 0, 59], ["hour", 0, 23], ["day of month", 1, 31], ["month", 1, 12], ["day of week", 0, 7]] as const;

function field(text: string, i: number): number[] | null {
  const [name, lo, hi] = FIELD[i]!;
  if (text === "*" || text === "?") return null;
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|[a-z0-9]+)(?:-([a-z0-9]+))?(?:\/(\d+))?$/i.exec(part);
    const val = (s: string) => {
      const n = /^\d+$/.test(s) ? Number(s) : NAMES[s.toLowerCase()];
      if (n === undefined || n < lo || n > hi) throw new Bad(`${name} "${part}" isn't from ${lo} to ${hi}`);
      return n;
    };
    if (!m) throw new Bad(`${name} "${part}" isn't a cron field`);
    const a = m[1] === "*" ? lo : val(m[1]!), b = m[2] ? val(m[2]) : m[1] === "*" || m[3] ? hi : a, step = m[3] ? Number(m[3]) : 1;
    if (step < 1 || b < a) throw new Bad(`${name} "${part}" runs backwards`);
    for (let n = a; n <= b; n += step) out.add(i === 4 && n === 7 ? 0 : n);
  }
  const list = [...out].sort((x, y) => x - y);
  // "*/1" and "0-59" are the same as "*": leave the field open so day-of-month/day-of-week don't OR against it.
  return list.length === (i === 4 ? 7 : hi - lo + 1) && i >= 2 ? null : list;
}

function parseCron(expr: string): Fields {
  const parts = (ALIASES[expr.trim().toLowerCase()] ?? expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Bad("five fields: minute hour day-of-month month day-of-week", ["expr"]);
  const [min, hour, dom, month, dow] = parts.map(field);
  const all = (n: number, lo = 0) => Array.from({ length: n }, (_, k) => k + lo);
  return { min: min ?? all(60), hour: hour ?? all(24), dom: dom!, month: month!, dow: dow! };
}

// ---- wall clocks ----

const fmts = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string) => {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }));
  return f;
};

export interface Wall { y: number; m: number; d: number; h: number; mi: number; s: number }

/** What a clock in `tz` reads at `t`. */
export function wall(t: number, tz: string): Wall {
  const p: Record<string, number> = {};
  for (const { type, value } of fmt(tz).formatToParts(t)) p[type] = Number(value);
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute!, s: p.second! };
}

const offset = (t: number, tz: string) => {
  const w = wall(t, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
};

/**
 * The moment a clock in `tz` reads this wall time. A time the clocks skip (spring forward) lands just after
 * the jump; a time they pass twice (fall back) is the first of the two.
 */
export function fromWall(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const o1 = offset(guess, tz), a = guess - o1, o2 = offset(a, tz);
  if (o1 === o2) return a;
  const b = guess - o2;
  return offset(b, tz) === o2 ? b : a;
}

// ---- next run ----

interface Rule { min: number[]; hour: number[]; day(y: number, m: number, d: number, dow: number): boolean }

const at = (time: string) => ({ hour: [Number(time.slice(0, 2))], min: [Number(time.slice(3, 5))] });

function rule(c: Exclude<Cadence, { kind: "once" | "every" }>): Rule {
  switch (c.kind) {
    case "daily": return { ...at(c.time), day: () => true };
    case "weekly": return { ...at(c.time), day: (_y, _m, _d, dow) => c.days.includes(dow) };
    case "monthly": return { ...at(c.time), day: (y, m, d) => d === (c.day === -1 ? daysIn(y, m) : Math.min(c.day, daysIn(y, m))) };
    case "yearly": return { ...at(c.time), day: (y, m, d) => m === c.month && d === Math.min(c.day, daysIn(y, m)) };
    case "cron": {
      const f = parseCron(c.expr);
      return {
        min: f.min, hour: f.hour,
        day: (_y, m, d, dow) => (!f.month || f.month.includes(m)) &&
          // Like every cron since Vixie's: with both day fields set, either one will do.
          (f.dom && f.dow ? f.dom.includes(d) || f.dow.includes(dow) : (!f.dom || f.dom.includes(d)) && (!f.dow || f.dow.includes(dow))),
      };
    }
  }
}

/** Eight years: long enough for "Feb 29 that's a Monday", short enough that a cadence that never comes stops. */
const HORIZON_DAYS = 8 * 366;

/**
 * The first minute after `after` (ms) that `c` runs on a `tz` clock, or null when it never will again.
 * `anchor` is where an "every" count starts (when the job was made).
 */
export function next(c: Cadence, after: number, tz: string, anchor = after): number | null {
  if (c.kind === "once") {
    const t = fromWall(+c.at.slice(0, 4), +c.at.slice(5, 7), +c.at.slice(8, 10), +c.at.slice(11, 13), +c.at.slice(14, 16), tz);
    return t > after ? t : null;
  }
  if (c.kind === "every") {
    const step = c.minutes * MINUTE, base = Math.floor(anchor / MINUTE) * MINUTE;
    return after < base ? base : base + (Math.floor((after - base) / step) + 1) * step;
  }
  const r = rule(c), w = wall(after, tz), hours = [...r.hour].sort((a, b) => a - b), mins = [...r.min].sort((a, b) => a - b);
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const day = new Date(Date.UTC(w.y, w.m - 1, w.d + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    if (!r.day(y, m, d, day.getUTCDay())) continue;
    for (const h of hours) {
      if (i === 0 && h < w.h - 1) continue; // an hour of slack for a clock change today
      for (const mi of mins) {
        const t = fromWall(y, m, d, h, mi, tz);
        if (t > after) return t;
      }
    }
  }
  return null;
}

/** The next `n` runs after `after`. */
export function upcoming(c: Cadence, after: number, tz: string, n: number, anchor = after): number[] {
  const out: number[] = [];
  for (let t = next(c, after, tz, anchor); t !== null && out.length < n; t = next(c, t, tz, anchor)) out.push(t);
  return out;
}

// ---- lanes and words ----

/** Which lane a cadence sits in. A cron line goes by its widest set field; one that fires many times a day is async. */
export function flow(c: Cadence): Flow {
  if (c.kind === "once" || c.kind === "every") return "async";
  if (c.kind !== "cron") return c.kind;
  const f = parseCron(c.expr);
  if (f.month) return "yearly";
  if (f.dom) return "monthly";
  if (f.dow) return "weekly";
  return f.hour.length * f.min.length <= 4 ? "daily" : "async";
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nth = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");

function span(minutes: number): string {
  const parts: string[] = [], d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
  if (d) parts.push(`${d} d`);
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  return parts.join(" ");
}

/** A cadence in a few plain words: "Weekdays at 09:00", "Every 15 min". */
export function describe(c: Cadence): string {
  switch (c.kind) {
    case "once": return `Once, ${c.at.slice(8, 10)} ${MONTH_NAMES[+c.at.slice(5, 7) - 1]} ${c.at.slice(0, 4)} at ${c.at.slice(11)}`;
    case "every": return `Every ${span(c.minutes)}`;
    case "daily": return `Daily at ${c.time}`;
    case "weekly": {
      const k = c.days.join();
      const which = k === "1,2,3,4,5" ? "Weekdays" : k === "0,6" ? "Weekends" : c.days.length === 7 ? "Every day" : c.days.map((d) => DAY_NAMES[d]).join(", ");
      return `${which} at ${c.time}`;
    }
    case "monthly": return `Monthly on the ${c.day === -1 ? "last day" : nth(c.day)} at ${c.time}`;
    case "yearly": return `Yearly on ${c.day} ${MONTH_NAMES[c.month - 1]} at ${c.time}`;
    case "cron": return `cron ${c.expr.trim()}`;
  }
}
