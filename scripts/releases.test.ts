import { expect, test } from "bun:test";
import { appDot, busiest, repoDot, tally } from "./releases-lib.ts";

test("each app gets the dot the owner reads it by", () => {
  const up = { ok: true }, down = { ok: false };
  const base = { link: "https://x.dev", live: up, light: "green", releaseOk: null, released: false };
  expect([
    appDot({ ...base, id: "mythic-masters" }),                                    // its page answers
    appDot({ ...base, id: "auto-rig", live: down, light: "red" }),                 // its page is down
    appDot({ ...base, id: "agent-office", link: null, live: null, releaseOk: false }), // its desktop release failed
    appDot({ ...base, id: "rustybuns", link: null, live: null, released: true }),  // released, nothing to ping
    appDot({ ...base, id: "qollab", link: null, live: null }),                     // built, not shipped yet
    appDot({ ...base, id: "nextjs-example" }),                                     // a framework example
    appDot({ ...base, id: "terraviz-demo", link: null, live: null }),              // code we don't ship
  ]).toEqual(["live", "error", "error", "live", "testing", "code", "code"]);
});

test("each other repo gets its dot from its homepage and its last run", () => {
  const base = { archived: false, link: null, live: null, lastRun: null, daysQuiet: 3 };
  expect([
    repoDot({ ...base, link: "https://a.app", live: { ok: true } }),
    repoDot({ ...base, link: "https://a.app", live: { ok: false } }),
    repoDot({ ...base, lastRun: "failure" }),
    repoDot(base),
    repoDot({ ...base, daysQuiet: 200 }),
    repoDot({ ...base, archived: true, link: "https://a.app", live: { ok: false } }),
  ]).toEqual(["live", "error", "error", "testing", "code", "code"]);
});

test("PRs count today and this week, busiest first", () => {
  const now = new Date(2026, 10, 18, 15);
  const at = (days: number, hour = 12) => new Date(2026, 10, 18 - days, hour).toISOString();
  const prs = [{ mergedAt: at(0), apps: ["a", "b"] }, { mergedAt: at(0, 1), apps: ["a", "a"] }, { mergedAt: at(3), apps: ["b"] }, { mergedAt: at(9), apps: ["b"] }];
  const c = tally(prs, (p) => p.apps, now);
  expect(Object.fromEntries(c)).toEqual({ a: { today: 2, week: 2 }, b: { today: 1, week: 2 } });
  const rows = [{ name: "b", dot: "live" as const, ...c.get("b")! }, { name: "quiet", dot: "error" as const, today: 0, week: 0 }, { name: "a", dot: "live" as const, ...c.get("a")! }];
  expect(busiest(rows).map((r) => r.name)).toEqual(["a", "b", "quiet"]);
});
