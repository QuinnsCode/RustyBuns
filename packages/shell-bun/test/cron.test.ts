import { expect, test } from "bun:test";
import { cronMatches, parseCron, schedule } from "../src/cron.ts";

const at = (s: string) => new Date(s + "Z");

test("parseCron: fields, ranges, steps, lists and names", () => {
  const hourly = parseCron("0 * * * *");
  expect(cronMatches(hourly, at("2026-10-09T13:00:30"))).toBe(true);
  expect(cronMatches(hourly, at("2026-10-09T13:01:00"))).toBe(false);
  const c = parseCron("*/15 9-17 * * MON-FRI");
  expect(cronMatches(c, at("2026-10-09T09:45:00"))).toBe(true);    // a Friday
  expect(cronMatches(c, at("2026-10-10T09:45:00"))).toBe(false);   // Saturday
  expect(cronMatches(c, at("2026-10-09T18:00:00"))).toBe(false);
  expect(cronMatches(parseCron("30 2 1,15 JAN,JUL *"), at("2026-07-15T02:30:00"))).toBe(true);
  expect(cronMatches(parseCron("0 0 * * 7"), at("2026-10-11T00:00:00"))).toBe(true);  // 7 is Sunday too
  expect(cronMatches(parseCron("5/20 * * * *"), at("2026-10-09T00:45:00"))).toBe(true);
});

test("parseCron: both day fields restricted fires on either", () => {
  const c = parseCron("0 0 13 * FRI");
  expect(cronMatches(c, at("2026-10-13T00:00:00"))).toBe(true);    // the 13th, a Tuesday
  expect(cronMatches(c, at("2026-10-09T00:00:00"))).toBe(true);    // a Friday
  expect(cronMatches(c, at("2026-10-10T00:00:00"))).toBe(false);
});

test("parseCron: refuses what cron would", () => {
  expect(() => parseCron("* * * *")).toThrow("5 fields");
  expect(() => parseCron("60 * * * *")).toThrow("out of range");
  expect(() => parseCron("*/0 * * * *")).toThrow("bad step");
  expect(() => parseCron("5-1 * * * *")).toThrow("backwards");
});

test("schedule fires matching crons at the top of the minute, and stops", async () => {
  let t = Date.UTC(2026, 9, 9, 12, 59, 59, 980);
  const fired: { cron: string; scheduledTime: number }[] = [];
  const stop = schedule(["0 13 * * *", "1 13 * * *"], (c) => { fired.push({ cron: c.cron, scheduledTime: c.scheduledTime }); }, { now: () => t });
  t += 20;
  await Bun.sleep(60);
  stop();
  expect(fired).toEqual([{ cron: "0 13 * * *", scheduledTime: Date.UTC(2026, 9, 9, 13, 0) }]);
});
