import { expect, test } from "bun:test";
import { previewApps, rangeLine, ringLines, rollbackCandidates, sinceLastGreen, soaked, type Commit, type Tested } from "./rings.ts";

const sha = (c: string) => c.repeat(40);
const [a, b, c, d] = ["a", "b", "c", "d"].map(sha) as [string, string, string, string];

test.each<[string, Tested[], { green?: string; shas: string[] }]>([
  // red at the head, two untested squash commits under it, then the green one
  ["red after a green", [{ sha: a, state: "FAILURE" }, { sha: b }, { sha: c }, { sha: d, state: "SUCCESS" }], { green: d, shas: [a, b, c] }],
  ["head is green", [{ sha: a, state: "SUCCESS" }, { sha: b, state: "FAILURE" }], { green: a, shas: [] }],
  ["an older red doesn't stop the walk", [{ sha: a, state: "FAILURE" }, { sha: b, state: "FAILURE" }, { sha: c, state: "SUCCESS" }], { green: c, shas: [a, b] }],
  ["no green in view", [{ sha: a, state: "FAILURE" }, { sha: b }], { shas: [a, b] }],
])("sinceLastGreen: %s", (_, history, want) => {
  expect(sinceLastGreen(history)).toEqual(want);
});

test("rangeLine links the compare view from the last green to the head", () => {
  expect(rangeLine("o/r", [{ sha: a, state: "FAILURE" }, { sha: b }, { sha: c, state: "SUCCESS" }]))
    .toBe(`Since the last green (ccccccc): 2 commits, https://github.com/o/r/compare/${c}...${a}`);
  expect(rangeLine("o/r", [{ sha: a, state: "FAILURE" }])).toBe("No green ring run in the last 1 commits; newest is aaaaaaa.");
});

const [e, f] = ["e", "f"].map(sha) as [string, string];
// main's newest first: a red head, a green, an untested one, a green, a red, a green
const line: Tested[] = [{ sha: a, state: "FAILURE" }, { sha: b, state: "SUCCESS" }, { sha: c }, { sha: d, state: "SUCCESS" }, { sha: e, state: "FAILURE" }, { sha: f, state: "SUCCESS" }];
test.each<[string, string | undefined, string[]]>([
  ["the ring is at a green: the older greens, skipping reds and untested", b, [d, f]],
  ["no ref yet: the newest green counts as current", undefined, [d, f]],
  ["the oldest green has nowhere to go", f, []],
  ["a SHA that scrolled out of view", "9".repeat(40), []],
])("rollbackCandidates: %s", (_, from, want) => {
  expect(rollbackCandidates(line, from)).toEqual(want);
});

const G = "SUCCESS", R = "FAILURE";
test.each<[string, Tested[], string | undefined]>([
  // newest first: the pick is the third green from the top of the newest streak (its own run and two after it)
  ["four greens: the third one", [{ sha: a, state: G }, { sha: b, state: G }, { sha: c, state: G }, { sha: d, state: G }], c],
  ["untested squash commits share a run", [{ sha: a, state: G }, { sha: b }, { sha: c, state: G }, { sha: d, state: G }], d],
  ["a red at the head: soak under it", [{ sha: a, state: R }, { sha: b, state: G }, { sha: c, state: G }, { sha: d, state: G }], d],
  ["a red breaks the streak", [{ sha: a, state: G }, { sha: b, state: G }, { sha: c, state: R }, { sha: d, state: G }, { sha: e, state: G }, { sha: f, state: G }], f],
  ["only two greens yet", [{ sha: a, state: G }, { sha: b, state: G }, { sha: c, state: R }], undefined],
])("soaked: %s", (_, history, want) => {
  expect(soaked(history, 3)).toBe(want);
});

test("previewApps: changed web apps with a vite build, all of them when shared code moved", () => {
  const builds = { "two-fronts": "vite build", "mythic-masters": "bun --bun vite build", "auto-rig": "vite build", "hello-world": "rustybuns build desktop" };
  const apps = ["two-fronts", "mythic-masters", "hello-world"];
  expect(previewApps(["apps/two-fronts/src/a.ts", "apps/auto-rig/x.ts", "apps/hello-world/y.ts", "notes/z.md"], builds, apps)).toEqual(["two-fronts"]);
  expect(previewApps(["packages/util/src/x.ts"], builds, apps)).toEqual(["mythic-masters", "two-fronts"]);
  expect(previewApps("all", builds, apps)).toEqual(["mythic-masters", "two-fronts"]);
// main, newest first, an hour apart: hourly went red on the head and green two commits down; daily took the fourth.
const now = Date.parse("2026-11-14T12:00:00Z");
const hour = (h: number) => new Date(now - h * 3600_000).toISOString();
const main: Commit[] = [a, b, c, d, e, f].map((s, i) => ({ sha: s, date: hour(i + 1), rings: {} }));
main[0]!.rings.hourly = { state: "FAILURE", at: hour(0.5) };
main[2]!.rings.hourly = { state: "SUCCESS", at: hour(2.5) };
main[3]!.rings.daily = { state: "SUCCESS", at: hour(3.5) };
test.each<[string, Record<string, string>, string[]]>([
  ["no refs yet: each ring sits at its newest green", {}, [
    "hourly  ccccccc   3h old (no ref)  red 30m ago aaaaaaa  2 waiting",
    "daily   ddddddd   4h old (no ref)  no red  1 waiting",
    "stable  not run yet",
  ]],
  ["the refs win over the newest green", { hourly: c, daily: f }, [
    "hourly  ccccccc   3h old  red 30m ago aaaaaaa  2 waiting",
    "daily   fffffff   6h old  no red  3 waiting",
    "stable  not run yet",
  ]],
  ["a ref older than the commits in view", { hourly: "9".repeat(40) }, [
    "hourly  9999999  older than main's last 6, red 30m ago aaaaaaa",
    "daily   ddddddd   4h old (no ref)  no red  ? waiting",
    "stable  not run yet",
  ]],
])("ringLines: %s", (_, refs, want) => {
  expect(ringLines(main, refs, now)).toEqual(want);
});
