import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appDot, busiest, deployOf, hasState, owed, pacific, repoDot, stateDirs, tally } from "./releases-lib.ts";

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

test("last push reads in Pacific time, PST or PDT by the date", () => {
  expect([pacific("2026-12-14T00:56:00Z"), pacific("2026-07-04T21:05:00Z")]).toEqual(["4:56pm PST Dec-13-2026", "2:05pm PDT Jul-04-2026"]);
});

test("an app is owed a re-release when main moved it after its last deploy, or no deploy is logged", () => {
  const base = { id: "two-fronts", link: "https://x.dev", dot: "live" as const, pushed: "2026-11-21T10:00:00Z", deployed: "2026-11-21T09:00:00Z" };
  expect([
    owed(base),                                           // merged after the deploy
    owed({ ...base, deployed: "2026-11-21T11:00:00Z" }),  // deployed since
    owed({ ...base, deployed: null }),                    // never logged
    owed({ ...base, link: null }),                        // nothing live to update
    owed({ ...base, id: "rustybuns", link: "https://www.npmjs.com/package/rustybuns" }), // npm goes out by a v tag
  ]).toEqual([true, false, true, false, false]);
  const cli = "bun ../../packages/cli/src/" + "index.ts";
  expect([
    deployOf("codesplitter", "anything"),
    deployOf("two-fronts", "bunx rustybuns deploy"),
    deployOf("eqosys", `${cli} deploy`),
    deployOf("git-recon", `vite build && bunx wrangler deploy && ${cli} report-deploy --app git-recon`),
    deployOf("qollab", null),
  ]).toEqual([
    { plan: false, cmd: "zsh scripts/release-codesplitters.sh" },
    { plan: true, cmd: "bun run deploy" }, { plan: true, cmd: "bun run deploy" }, { plan: false, cmd: "bun run deploy" }, null,
  ]);
});

test("the walker sees no state in a checkout of another clone, and won't plan a FRESH copy there", () => {
  const app = mkdtempSync(join(tmpdir(), "rel-")), shared = mkdtempSync(join(tmpdir(), "rel-shared-"));
  mkdirSync(join(shared, "state"));
  expect(hasState(stateDirs(app, shared))).toBe(false); // the job checkout: its git dir has an empty state
  mkdirSync(join(shared, "state", "eqosys", "live_ryanquinn"), { recursive: true });
  expect(hasState(stateDirs(app, shared))).toBe(true);
  expect(hasState(stateDirs(app, null))).toBe(false);    // outside git, only .alchemy/state counts
});
