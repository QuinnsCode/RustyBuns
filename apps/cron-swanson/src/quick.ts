// The big add at the top: what, when (no further than three months out) and how often, turned into the cadence
// the engine takes. The time is the page's own clock in its own time zone, the same one the job is saved with.
import type { Cadence } from "./bacron.ts";

/** How far ahead an alarm may be set: three months. */
export const FURTHEST_MS = 92 * 86_400_000;

export const OFTEN = {
  once: "Once",
  m15: "Every 15 min",
  h1: "Every hour",
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Every week",
  monthly: "Every month",
} as const;
export type Often = keyof typeof OFTEN;
export const isOften = (v: unknown): v is Often => typeof v === "string" && Object.hasOwn(OFTEN, v);

/** "Every 15 min" and "Every hour" start counting from now, so they don't need a time. */
export const needsTime = (o: Often) => o !== "m15" && o !== "h1";

const pad = (n: number) => String(n).padStart(2, "0");
/** A local clock reading for a datetime-local input: "2026-11-24T09:00". */
export const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The cadence for `often` starting at `at` (a local clock), or why not: in the past, or past three months. */
export function cadenceFor(often: Often, at: Date, now: number): Cadence | string {
  if (needsTime(often)) {
    if (Number.isNaN(at.getTime())) return "Pick a time.";
    if (at.getTime() <= now) return "That time has passed.";
    if (at.getTime() > now + FURTHEST_MS) return "No further than three months out.";
  }
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  switch (often) {
    case "once": return { kind: "once", at: local(at) };
    case "m15": return { kind: "every", minutes: 15 };
    case "h1": return { kind: "every", minutes: 60 };
    case "daily": return { kind: "daily", time };
    case "weekdays": return { kind: "weekly", time, days: [1, 2, 3, 4, 5] };
    case "weekly": return { kind: "weekly", time, days: [at.getDay()] };
    case "monthly": return { kind: "monthly", time, day: at.getDate() };
  }
}

/** The quick picks for when: soon, later today, tonight, tomorrow morning, next week. */
export function quickTimes(now: number): { label: string; at: Date }[] {
  const at = (f: (d: Date) => void) => { const d = new Date(now); d.setSeconds(0, 0); f(d); return d; };
  const tonight = at((d) => d.setHours(21, 0)), morning = at((d) => { d.setDate(d.getDate() + 1); d.setHours(9, 0); });
  return [
    { label: "In 15 min", at: at((d) => d.setMinutes(d.getMinutes() + 15)) },
    { label: "In 1 hour", at: at((d) => d.setHours(d.getHours() + 1)) },
    ...(tonight.getTime() > now ? [{ label: "Tonight 9 pm", at: tonight }] : []),
    { label: "Tomorrow 9 am", at: morning },
    { label: "Next week", at: at((d) => { d.setDate(d.getDate() + 7); d.setHours(9, 0); }) },
  ];
}
