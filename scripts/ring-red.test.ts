import { expect, test } from "bun:test";
import { bisect, blameLine, GRACE_MIN, jobsFor, lastBlame, prOf, redRange, revertDue, type Blame, type Verdict } from "./ring-red.ts";
import type { Tested } from "./rings.ts";

const sha = (c: string) => c.repeat(40);
const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(sha) as [string, string, string, string, string];

test.each<[string, Tested[], ReturnType<typeof redRange>]>([
  // main newest first: an untested commit above the red run, two untested under it, then the green
  ["red after a green", [{ sha: a }, { sha: b, state: "FAILURE" }, { sha: c }, { sha: d }, { sha: e, state: "SUCCESS" }], { red: b, green: e, candidates: [d, c, b] }],
  ["green", [{ sha: a, state: "SUCCESS" }, { sha: b, state: "FAILURE" }], { why: `hourly is green at ${a.slice(0, 7)}` }],
  ["no green to start from", [{ sha: a, state: "FAILURE" }, { sha: b }], { why: `red at ${a.slice(0, 7)} and no green hourly in view to bisect from` }],
])("redRange: %s", (_, h, want) => {
  expect(redRange(h)).toEqual(want);
});

// Commits 0..7 oldest first; the first bad one is where the suite starts failing.
test.each([[0], [3], [7]])("bisect finds the first bad of eight when it is #%i, testing log2(n) commits", async (firstBad) => {
  const shas = [..."01234567"].map(sha);
  const tried: string[] = [];
  const got = await bisect(shas, async (s) => (tried.push(s), shas.indexOf(s) >= firstBad ? "fail" : "pass"));
  expect(got).toBe(shas[firstBad]);
  expect(tried.length).toBeLessThanOrEqual(3);
});

test("bisect gives up when Bob can't take a run, and a single candidate is its own answer", async () => {
  expect(await bisect([a, b, c], async (): Promise<Verdict> => "skip")).toBeUndefined();
  expect(await bisect([a], async () => { throw new Error("not called"); })).toBe(a);
});

test("jobsFor: the hourly's job names become the commands it ran; other OSes' smokes can't be bisected on Bob", () => {
  const apps = { include: [
    { app: "fm-daw", shard: "", prep: "", test: "bun test test", boot: false },
    { app: "auto-rig", shard: "", prep: "bun run build:native", test: "bun test test", boot: true },
  ] };
  const smoke = { include: [
    { app: "agent-office", runner: "macos-latest", target: "darwin-arm64", smoke: "bun run desktop:build && bun run desktop:smoke" },
    { app: "agent-office", runner: "ubuntu-latest", target: "linux-x64", smoke: "bun run desktop:build && bun run desktop:smoke" },
  ] };
  expect(jobsFor(["test fm-daw", "test auto-rig", "suite", "packages", "smoke agent-office darwin-arm64", "smoke agent-office linux-x64", "plan"], apps, smoke)).toEqual({
    jobs: [
      { label: "test fm-daw", dir: "apps/fm-daw", cmd: "bun test test" },
      { label: "test auto-rig", dir: "apps/auto-rig", cmd: "bun run build:native && bun test test && bun ../../scripts/boot.ts" },
      { label: "suite", dir: "apps/codesplitter", cmd: "bun test --parallel test" },
      { label: "packages", dir: ".", cmd: "bun test packages" },
      { label: "smoke agent-office darwin-arm64", dir: "apps/agent-office", cmd: "bun run desktop:build && bun run desktop:smoke" },
    ],
    cant: ["smoke agent-office linux-x64", "plan"],
  });
});

test("prOf reads the squash title's PR, not an issue it closes", () => {
  expect(prOf("fm-daw Shape: automate the EQ bands (closes #4518) (#4530)")).toBe(4530);
  expect(prOf("a commit pushed straight")).toBeUndefined();
});

test("the newest blame marker wins, read back from the issue's comments", () => {
  const old: Blame = { red: a, sha: b, pr: 10, at: Date.parse("2026-11-14T09:00:00Z") };
  const now: Blame = { red: a, sha: c, pr: 11, at: Date.parse("2026-11-14T10:00:00Z") };
  expect(lastBlame([`x\n${blameLine(old)}`, "Failed again", `y\n${blameLine(now)}`, "Failed again"])).toEqual(now);
  expect(lastBlame(["Failed again"])).toBeUndefined();
});

const t0 = Date.parse("2026-11-14T10:00:00Z"), later = t0 + GRACE_MIN * 60_000;
const blamed: Blame = { red: a, sha: b, pr: 42, at: t0 };
const redLine: Tested[] = [{ sha: a, state: "FAILURE" }, { sha: b }, { sha: c, state: "SUCCESS" }];
test.each<[string, Blame, number, Tested[], { sha: string; subject: string }[], boolean]>([
  ["still red after the grace", blamed, later, redLine, [{ sha: a, subject: "something else (#43)" }], true],
  ["inside the grace", blamed, later - 60_000, redLine, [], false],
  ["went green", blamed, later, [{ sha: d, state: "SUCCESS" }, ...redLine], [], false],
  ["a fix names the PR and the ring hasn't tested it yet", blamed, later, [{ sha: d }, ...redLine], [{ sha: d, subject: "fix the thing #42 broke (#44)" }], false],
  ["nobody was blamed (it passed on Bob)", { red: a, sha: a, at: t0 }, later * 2, redLine, [], false],
])("revertDue: %s", (_, bl, now, h, newer, due) => {
  expect(revertDue(bl, now, h, newer).due).toBe(due);
});
