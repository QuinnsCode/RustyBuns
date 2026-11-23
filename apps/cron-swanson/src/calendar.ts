// The calendar view: one week, a column a day and a row an hour, each alarm's runs as chips in their hour. An alarm
// that comes round more than once an hour is one chip with a count, so every 15 minutes doesn't bury the week.
import { esc } from "@rustybuns/util";
import { upcoming, type Flow } from "./bacron.ts";
import type { Job } from "./api.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR;

/** Midnight on the Monday of the week holding `t`, `weeks` weeks on. */
export function weekStart(t: number, weeks = 0): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weeks * 7);
  return d.getTime();
}

interface Chip { job: Job; flow: Flow; at: number; count: number }

/** The chips for the week from `start`: one per alarm per hour it runs in, with how many runs that hour holds. */
function chips(jobs: { job: Job; flow: Flow }[], start: number): Chip[] {
  const out = new Map<string, Chip>();
  for (const { job, flow } of jobs) {
    if (!job.enabled || job.nextAt === null) continue;
    for (const at of upcoming(job.cadence, start - 1, job.tz, 800, job.anchor)) {
      if (at >= start + 7 * DAY) break;
      const key = `${job.id}:${Math.floor(at / HOUR)}`, had = out.get(key);
      if (had) had.count++; else out.set(key, { job, flow, at, count: 1 });
    }
  }
  return [...out.values()];
}

/** The week as markup: day heads, an hour rail, the chips, and a line at now. */
export function weekGrid(jobs: { job: Job; flow: Flow }[], start: number, now: number): string {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const today = new Date(now).toDateString();
  const head = days.map((d) => `<div class="cal-day ${d.toDateString() === today ? "today" : ""}"><small>${d.toLocaleDateString(undefined, { weekday: "short" })}</small><b>${d.getDate()}</b></div>`).join("");
  const rail = Array.from({ length: 24 }, (_, h) => `<div class="cal-hour"><small>${h ? new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" }) : ""}</small></div>`).join("");
  const all = chips(jobs, start);
  const cols = days.map((d, i) => {
    const from = d.getTime(), to = from + DAY;
    const mine = all.filter((c) => c.at >= from && c.at < to).sort((a, b) => a.at - b.at);
    const perHour = Map.groupBy(mine, (c) => new Date(c.at).getHours());
    const placed = mine.map((c) => {
      const t = new Date(c.at), top = (t.getHours() + t.getMinutes() / 60) * 100 / 24;
      const hour = perHour.get(t.getHours())!, i = hour.indexOf(c), n = hour.length;
      return `<button type="button" class="cal-chip lane-${c.flow}" style="top:${top.toFixed(3)}%;left:calc(${i} * (100% - 6px) / ${n} + 3px);width:calc((100% - 6px) / ${n} - 2px)" data-job="${esc(c.job.id)}" title="${esc(c.job.name)} · ${esc(t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}"><i></i><span>${esc(c.job.name)}</span>${c.count > 1 ? `<em>×${c.count}</em>` : ""}</button>`;
    }).join("");
    const line = new Date(now).toDateString() === d.toDateString() ? `<div class="cal-now" style="top:${(((now - from) / DAY) * 100).toFixed(3)}%"></div>` : "";
    return `<div class="cal-col" data-day="${i}">${placed}${line}</div>`;
  }).join("");
  return `<div class="cal"><div class="cal-head"><span></span>${head}</div><div class="cal-body"><div class="cal-rail">${rail}</div>${cols}</div></div>`;
}
