// The add form's one line: every N (0 to 60) minutes, hours, days, weeks or months, from a start no further than three
// months out, turned into the cadence the engine takes. N is tidied into the unit a person would say: 60 minutes is an
// hour, 24 hours a day, 14 days two weeks, 31 days a month, 12 months a year. 0 means once, at the start.
// Plain Dates on the page's own clock: the engine already knows month lengths (the 31st runs on a short month's last day).
import type { Cadence } from "./bacron.ts";

export const UNITS = ["minute", "hour", "day", "week", "month"] as const;
export type Unit = (typeof UNITS)[number];
export const isUnit = (v: unknown): v is Unit => typeof v === "string" && (UNITS as readonly string[]).includes(v);

/** How far ahead the start may be: three months. */
export const FURTHEST_MS = 92 * 86_400_000;
export const MAX_N = 60;

const pad = (n: number) => String(n).padStart(2, "0");
/** A local clock reading for a datetime-local input: "2026-11-24T09:00". */
export const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Every" counts from the moment it's made, so minutes, hours, and every N days or weeks start now. */
export function startsNow(n: number, unit: Unit): boolean {
  if (n <= 0) return false;
  const t = tidy(n, unit);
  return t.unit === "minute" || t.unit === "hour" || ((t.unit === "day" || t.unit === "week") && t.n > 1);
}

/** N of `unit` said the plainest way: 90 minutes stays, 120 minutes is 2 hours, 30 days is a month. */
function tidy(n: number, unit: Unit): { n: number; unit: Unit } {
  if (unit === "minute" && n % 60 === 0 && n > 0) return tidy(n / 60, "hour");
  if (unit === "hour" && n % 24 === 0 && n > 0) return tidy(n / 24, "day");
  if (unit === "day" && n >= 28) {
    const months = Math.round(n / 30.44);
    if (Math.abs(n - months * 30.44) <= 2) return { n: months, unit: "month" };
  }
  if (unit === "day" && n % 7 === 0 && n > 0) return { n: n / 7, unit: "week" };
  return { n, unit };
}

/** Months that divide a year evenly: every 5 months has no steady day, so it rounds to the nearest of these. */
const EVEN_MONTHS = [1, 2, 3, 4, 6, 12];

export interface Every { cadence: Cadence; n: number; unit: Unit; rounded: boolean }

/** The cadence for every `n` `unit` from `start`, or why not (a start that's passed, or past three months). */
export function every(n: number, unit: Unit, start: Date, now: number): Every | string {
  if (!Number.isInteger(n) || n < 0 || n > MAX_N) return `Pick 0 to ${MAX_N}.`;
  if (!startsNow(n, unit)) {
    if (Number.isNaN(start.getTime())) return "Pick when it starts.";
    if (start.getTime() <= now) return "That time has passed.";
    if (start.getTime() > now + FURTHEST_MS) return "No further than three months out.";
  }
  const time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  if (n === 0) return { cadence: { kind: "once", at: local(start) }, n, unit, rounded: false };
  const t = tidy(n, unit);
  switch (t.unit) {
    case "minute": return { cadence: { kind: "every", minutes: t.n }, ...t, rounded: false };
    case "hour": return { cadence: { kind: "every", minutes: t.n * 60 }, ...t, rounded: false };
    case "day": return { cadence: t.n === 1 ? { kind: "daily", time } : { kind: "every", minutes: t.n * 1440 }, ...t, rounded: false };
    case "week": return { cadence: t.n === 1 ? { kind: "weekly", time, days: [start.getDay()] } : { kind: "every", minutes: t.n * 10_080 }, ...t, rounded: false };
    case "month": {
      const m = EVEN_MONTHS.reduce((a, b) => (Math.abs(b - t.n) < Math.abs(a - t.n) ? b : a));
      const day = start.getDate();
      if (m === 1) return { cadence: { kind: "monthly", time, day }, n: 1, unit: "month", rounded: t.n !== 1 };
      if (m === 12) return { cadence: { kind: "yearly", time, month: start.getMonth() + 1, day }, n: 12, unit: "month", rounded: t.n !== 12 };
      const months = Array.from({ length: 12 / m }, (_, i) => ((start.getMonth() + i * m) % 12) + 1).sort((a, b) => a - b);
      return { cadence: { kind: "cron", expr: `${start.getMinutes()} ${start.getHours()} ${day} ${months.join(",")} *` }, n: m, unit: "month", rounded: t.n !== m };
    }
  }
}
