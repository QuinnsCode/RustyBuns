import { expect, test } from "bun:test";
import type { Cadence } from "../src/bacron.ts";
import { FURTHEST_MS, cadenceFor, type Often } from "../src/quick.ts";

// The big add's picks, on a page clock reading Mon 23 Nov 2026 14:00.
const now = new Date(2026, 10, 23, 14, 0).getTime();
const tue9 = new Date(2026, 10, 24, 9, 0);

test.each<[Often, Date, Cadence | string]>([
  ["once", tue9, { kind: "once", at: "2026-11-24T09:00" }],
  ["m15", new Date(Number.NaN), { kind: "every", minutes: 15 }],
  ["h1", new Date(Number.NaN), { kind: "every", minutes: 60 }],
  ["daily", tue9, { kind: "daily", time: "09:00" }],
  ["weekdays", tue9, { kind: "weekly", time: "09:00", days: [1, 2, 3, 4, 5] }],
  ["weekly", tue9, { kind: "weekly", time: "09:00", days: [2] }],
  ["monthly", tue9, { kind: "monthly", time: "09:00", day: 24 }],
  ["once", new Date(2026, 10, 23, 13, 0), "That time has passed."],
  ["daily", new Date(now + FURTHEST_MS + 60_000), "No further than three months out."],
  ["once", new Date(Number.NaN), "Pick a time."],
])("%s at %s", (often, at, want) => {
  expect(cadenceFor(often, at, now)).toEqual(want);
});
