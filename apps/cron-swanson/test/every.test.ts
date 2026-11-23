import { expect, test } from "bun:test";
import type { Cadence } from "../src/bacron.ts";
import { FURTHEST_MS, every, type Unit } from "../src/every.ts";

// The add form's line on a page clock reading Mon 23 Nov 2026 14:00, starting Tue 24 Nov 09:00.
const now = new Date(2026, 10, 23, 14, 0).getTime();
const tue9 = new Date(2026, 10, 24, 9, 0);

test.each<[number, Unit, Date, Cadence | string]>([
  [0, "day", tue9, { kind: "once", at: "2026-11-24T09:00" }],
  [15, "minute", new Date(Number.NaN), { kind: "every", minutes: 15 }],
  [60, "minute", new Date(Number.NaN), { kind: "every", minutes: 60 }],
  [24, "hour", tue9, { kind: "daily", time: "09:00" }],
  [1, "week", tue9, { kind: "weekly", time: "09:00", days: [2] }],
  [14, "day", new Date(Number.NaN), { kind: "every", minutes: 2 * 10_080 }],
  [31, "day", tue9, { kind: "monthly", time: "09:00", day: 24 }],
  [3, "month", tue9, { kind: "cron", expr: "0 9 24 2,5,8,11 *" }],
  [12, "month", tue9, { kind: "yearly", time: "09:00", month: 11, day: 24 }],
  [1, "day", new Date(2026, 10, 23, 13, 0), "That time has passed."],
  [1, "month", new Date(now + FURTHEST_MS + 60_000), "No further than three months out."],
  [61, "minute", tue9, "Pick 0 to 60."],
])("every %d %s", (n, unit, start, want) => {
  const got = every(n, unit, start, now);
  expect(typeof got === "string" ? got : got.cadence).toEqual(want);
});

test("five months has no steady day: it rounds to four and says so", () => {
  const got = every(5, "month", tue9, now);
  expect(typeof got !== "string" && [got.n, got.rounded]).toEqual([4, true]);
});
