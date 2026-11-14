import { expect, test } from "bun:test";
import { Bad } from "@rustybuns/util/guard";
import { Cadence, Zone, describe, flow, next, type Cadence as C } from "../src/bacron.ts";

const t = (iso: string) => Date.parse(iso);

// The calendar corners a scheduler gets wrong: month ends, leap years, clock changes, cron's either-day rule.
// Every row has all six cells: bun reads a missing last one as a done callback.
test.each<[string, C, string, string, string | null, string | null]>([
  ["daily, next morning in London", { kind: "daily", time: "09:00" }, "Europe/London", "2026-11-14T10:00:00Z", "2026-11-15T09:00:00Z", null],
  ["weekdays skip the weekend (New York)", { kind: "weekly", time: "09:00", days: [1, 2, 3, 4, 5] }, "America/New_York", "2026-11-13T15:00:00Z", "2026-11-16T14:00:00Z", null],
  ["the 31st in February is the 28th", { kind: "monthly", time: "09:00", day: 31 }, "UTC", "2026-02-01T00:00:00Z", "2026-02-28T09:00:00Z", null],
  ["last day in a leap February", { kind: "monthly", time: "09:00", day: -1 }, "UTC", "2028-02-01T00:00:00Z", "2028-02-29T09:00:00Z", null],
  ["Feb 29 yearly lands on Feb 28", { kind: "yearly", time: "08:00", month: 2, day: 29 }, "UTC", "2026-03-01T00:00:00Z", "2027-02-28T08:00:00Z", null],
  ["a time skipped in spring runs just after the jump", { kind: "daily", time: "02:30" }, "America/New_York", "2026-03-07T12:00:00Z", "2026-03-08T07:30:00Z", null],
  ["a time passed twice in autumn runs the first time", { kind: "daily", time: "01:30" }, "America/New_York", "2026-10-31T12:00:00Z", "2026-11-01T05:30:00Z", null],
  ["cron office hours roll to Monday", { kind: "cron", expr: "*/15 9-17 * * 1-5" }, "UTC", "2026-11-13T17:50:00Z", "2026-11-16T09:00:00Z", null],
  ["cron with both day fields takes either", { kind: "cron", expr: "0 0 13 * fri" }, "UTC", "2026-11-14T00:00:00Z", "2026-11-20T00:00:00Z", null],
  ["every 15 min counts from the anchor's minute", { kind: "every", minutes: 15 }, "UTC", "2026-11-14T10:30:00Z", "2026-11-14T10:37:00Z", "2026-11-14T10:07:30Z"],
  ["once, already past", { kind: "once", at: "2026-11-01T09:00" }, "UTC", "2026-11-14T00:00:00Z", null, null],
  ["once, on the job's own clock", { kind: "once", at: "2026-12-25T07:00" }, "Asia/Tokyo", "2026-11-14T00:00:00Z", "2026-12-24T22:00:00Z", null],
])("%s", (_, c, tz, after, want, anchor) => {
  const got = next(Cadence(c), t(after), tz, anchor === null ? undefined : t(anchor));
  expect(got === null ? null : new Date(got).toISOString()).toBe(want === null ? null : new Date(want).toISOString());
});

test("each cadence sits in one lane and reads as plain words", () => {
  const cases: [C, string, string][] = [
    [{ kind: "every", minutes: 90 }, "async", "Every 1 h 30 min"],
    [{ kind: "daily", time: "07:15" }, "daily", "Daily at 07:15"],
    [{ kind: "weekly", time: "09:00", days: [5, 1, 2, 3, 4] }, "weekly", "Weekdays at 09:00"],
    [{ kind: "monthly", time: "09:00", day: 22 }, "monthly", "Monthly on the 22nd at 09:00"],
    [{ kind: "yearly", time: "09:00", month: 4, day: 15 }, "yearly", "Yearly on 15 Apr at 09:00"],
    [{ kind: "cron", expr: "*/5 * * * *" }, "async", "cron */5 * * * *"],
    [{ kind: "cron", expr: "0 9,17 * * *" }, "daily", "cron 0 9,17 * * *"],
    [{ kind: "cron", expr: "@weekly" }, "weekly", "cron @weekly"],
    [{ kind: "cron", expr: "0 3 1 * *" }, "monthly", "cron 0 3 1 * *"],
    [{ kind: "cron", expr: "0 0 25 dec *" }, "yearly", "cron 0 0 25 dec *"],
  ];
  for (const [c, lane, words] of cases) expect([flow(Cadence(c)), describe(Cadence(c))]).toEqual([lane, words]);
});

test("a cadence that can't happen is refused with the field that's wrong", () => {
  const bad: [unknown, RegExp][] = [
    [{ kind: "cron", expr: "61 * * * *" }, /minute "61"/],
    [{ kind: "cron", expr: "0 9 * *" }, /five fields/],
    [{ kind: "yearly", time: "09:00", month: 2, day: 30 }, /^day/],
    [{ kind: "monthly", time: "09:00", day: 0 }, /^day/],
    [{ kind: "once", at: "2026-02-30T09:00" }, /^at/],
    [{ kind: "daily", time: "25:00" }, /^time/],
    [{ kind: "hourly" }, /^kind/],
  ];
  for (const [c, why] of bad) expect(() => Cadence(c)).toThrow(why);
  expect(() => Zone("Mars/Olympus_Mons")).toThrow(Bad);
});
