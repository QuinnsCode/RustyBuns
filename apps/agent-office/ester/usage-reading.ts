// The plan's weekly usage, read off Claude Code's status line, so the ledger has the week's last reading right before it
// resets without the owner typing /usage into `--budget`. Claude Code pipes the status line command a JSON with
// `rate_limits.seven_day` (used_percentage, resets_at) for a claude.ai plan, refreshed after each reply; this keeps the
// highest reading per reset morning in ~/.rustybuns/ledger/usage.json (a week's usage only grows) and prints one short line.
// No per-model (Fable) figure comes this way: that one stays `--budget ... --fable`.
// Wired as the project's statusLine in .claude/settings.json; by hand: echo '<json>' | bun apps/agent-office/ester/usage-reading.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { arr, check, num, obj, opt, str, type Of } from "@rustybuns/util/guard";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** One reading per plan week: the morning it resets (local date, as budget.json's `ends`), the highest percent seen, and when. */
export const Readings = arr(obj({ ends: str(10, { re: DATE }), pct: num(0, 200), at: str(40) }), 500, { drop: true });
export type Readings = Of<typeof Readings>;

const Window = obj({ used_percentage: num(0, 1000), resets_at: num(0, 1e11) });
/** What the status line is handed: only the fields read here. */
const Status = obj({
  model: opt(obj({ display_name: opt(str(100)) })),
  rate_limits: opt(obj({ five_hour: opt(Window), seven_day: opt(Window) })),
});

/** A moment's local date: the ledger's days and budget entries are local. */
const localDate = (ms: number) => { const t = new Date(ms); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };

/** The readings with this one folded in: a week keeps its highest percent, newest week last, the oldest dropped past 500. */
export function addReading(list: Readings, ends: string, pct: number, at: string): Readings {
  const old = list.find((r) => r.ends === ends);
  if (old && old.pct >= pct) return list;
  return [...list.filter((r) => r.ends !== ends), { ends, pct, at }].sort((a, b) => a.ends.localeCompare(b.ends)).slice(-500);
}

/** budget.json with the status line's readings laid over it: a reading higher than the owner's entry is later in the week,
 *  so it stands (and is exact, not approx); the owner's Fable figure stays. A week only a reading saw gets an entry. */
export function withReadings<B extends { ends: string; pct: number; fable?: number; approx?: boolean }>(budget: B[], readings: Readings): { ends: string; pct: number; fable?: number; approx?: boolean }[] {
  const by = new Map<string, { ends: string; pct: number; fable?: number; approx?: boolean }>(budget.map((b) => [b.ends, b]));
  for (const r of readings) {
    const b = by.get(r.ends), pct = Math.round(r.pct);
    if (!b) by.set(r.ends, { ends: r.ends, pct });
    else if (pct > b.pct) by.set(r.ends, { ends: r.ends, pct, ...(b.fable === undefined ? {} : { fable: b.fable }) });
  }
  return [...by.values()].sort((a, b) => a.ends.localeCompare(b.ends));
}

export const readingsFile = () => path.join(homedir(), ".rustybuns", "ledger", "usage.json");
export const readReadings = (file = readingsFile()): Readings => {
  try { return existsSync(file) ? Readings(JSON.parse(readFileSync(file, "utf8"))) : []; } catch { return []; }
};

if (import.meta.main) {
  const input = await Bun.stdin.text();
  const s = check(Status, (() => { try { return JSON.parse(input); } catch { return null; } })());
  const week = s?.rate_limits?.seven_day, five = s?.rate_limits?.five_hour;
  if (week) {
    const file = readingsFile(), list = readReadings(file);
    const next = addReading(list, localDate(week.resets_at * 1000), week.used_percentage, new Date().toISOString());
    if (next !== list) {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}`; // several sessions refresh at once: whole file or nothing
      writeFileSync(tmp, JSON.stringify(next));
      renameSync(tmp, file);
    }
  }
  const resets = week ? new Date(week.resets_at * 1000).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
  console.log([s?.model?.display_name, week && `week ${Math.round(week.used_percentage)}% (resets ${resets})`, five && `5h ${Math.round(five.used_percentage)}%`].filter(Boolean).join(" · "));
}
