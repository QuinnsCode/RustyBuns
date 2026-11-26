import { expect, test } from "bun:test";
import { APPS, appsFor, dropSample, laneCommands, sharedCode, sparseDirs } from "./ci-apps.ts";
import { appDir } from "./app-dirs.ts";

// A docs-only PR under packages/ used to run every app's suite (PR #5404: 4635 tests for a skill file).
test("only code under packages/, the lockfile and the apps workflow fan out to every app", () => {
  const cases: [string, boolean][] = [
    ["packages/util/src/guard.ts", true],
    ["packages/cli/package.json", true],
    ["bun.lock", true],
    [".github/workflows/apps.yml", true],
    ["packages/cli/skills/rustybuns/SKILL.md", false],
    ["packages/util/README.md", false],
    ["apps/two-fronts/src/main.ts", false],
    ["README.md", false],
  ];
  for (const [file, shared] of cases) expect([file, sharedCode(file)]).toEqual([file, shared]);
});

// #5899: playground's shelf.json is built from each package's package.json, so editing one runs playground's tests.
test("a package's package.json runs playground's tests besides its own folder's", () => {
  const cases: [string, string[]][] = [
    ["packages/models/package.json", ["playground"]],
    ["packages/models/src/human.ts", []],
    ["apps/two-fronts/src/main.ts", ["two-fronts"]],
    ["package.json", []],
  ];
  for (const [file, apps] of cases) expect([file, appsFor(file)]).toEqual([file, apps]);
});

// #5229: every app's tests in up to three lanes by time, the heavy files apart, and never an empty job.
test("a table of file times becomes balanced lanes, with no empty one", () => {
  const ms = (o: Record<string, number>) => Object.entries(o).map(([name, ms]) => ({ name, ms }));
  const files = (cmd: string) => cmd.split(" ").filter((w) => w.startsWith("./"));
  const cases: [Record<string, number>, string[][]][] = [
    [{ "test/a.test.ts": 229, "test/b.test.ts": 140, "test/c.test.ts": 98, "test/d.test.ts": 60, "test/e.test.ts": 30 },
      [["./test/a.test.ts"], ["./test/b.test.ts", "./test/e.test.ts"], ["./test/c.test.ts", "./test/d.test.ts"]]],
    [{ "test/a.test.ts": 5, "test/b.test.ts": 5 }, [["./test/a.test.ts"], ["./test/b.test.ts"]]],
    [{ "test/a.test.ts": 5 }, [["./test/a.test.ts"]]],
  ];
  for (const [times, want] of cases) expect(laneCommands("bun test test", ms(times), 3).map(files)).toEqual(want);
  // Flags and their values stay; the folder they ran over goes, since each lane names its files. Every lane bails.
  expect(laneCommands("bun test --parallel --timeout 30000 test", ms({ "test/a.test.ts": 1 }), 3))
    .toEqual(["bun test --bail --parallel --timeout 30000 ./test/a.test.ts"]);
});

// #5920: a lane runs the PR's own test files first and stops at its first failure, so its breakage shows in a minute.
test("in each lane the PR's changed test files run first", () => {
  const files = ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts", "test/d.test.ts"].map((name) => ({ name, ms: 10 }));
  expect(laneCommands("bun test test", files, 1, (f) => f === "test/c.test.ts"))
    .toEqual(["bun test --bail ./test/c.test.ts ./test/a.test.ts ./test/b.test.ts ./test/d.test.ts"]);
  expect(laneCommands("bun test --bail test", files, 1)).toEqual(["bun test --bail ./test/a.test.ts ./test/b.test.ts ./test/c.test.ts ./test/d.test.ts"]);
});

// #4136: a drop-pipeline PR dry-ran every app (~70 jobs a push, more runner time than the test suites); now one per build path.
test("a pipeline PR's dry drop builds one app per build path, never a tests-only app", () => {
  const apps = {
    "tests-only": { test: "bun test", drop: false as const },
    plain: {}, "plain-2": {},
    custom: { build: "bun run x" },
    native: { perOs: true }, "native-2": { perOs: true },
  };
  expect(dropSample(apps)).toEqual(["plain", "custom", "native"]);
  expect(dropSample({ plain: {} })).toEqual(["plain"]);
});

// #5509: a lane checks out its own app, plus any app whose code it runs, and none of the other ~900 MB.
// The first run of it went red where an app reached another by a relative path nobody listed (PR #5537).
test("a test lane's sparse checkout is its app, its `with` apps and the apps its code reaches", () => {
  expect(sparseDirs("two-fronts")).toBe("/apps/two-fronts/");
  expect(sparseDirs("agent-office")).toBe("/apps/agent-office/\n/apps/excalibrawl/");
  expect(sparseDirs("geoboxq-shopify")).toBe("/apps/geoboxq-shopify/\n/apps/geoboxq/"); // imports its worker
  expect(sparseDirs("codesplitter")).toContain("/apps/hello-world/"); // the welcome tour digs the folder up
});

// #5564: each job pays ~28 s before its first test, so the sub-minute suites run six to a job, and none splits into lanes.
test("a full run puts every sub-minute suite with nothing to build or boot in a job of at most six, and lanes only the long ones", async () => {
  const root = (await Bun.$`git rev-list --max-parents=0 HEAD`.text()).trim();
  const line = (await Bun.$`bun ${import.meta.dir}/ci-apps.ts test ${root}`.text()).split("\n").find((l) => l.startsWith("apps="))!;
  const rows: { app: string; dir: string; test: string; shard: string; filters: string; sparse: string }[] = JSON.parse(line.slice(5)).include;
  const groups = rows.filter((r) => r.app.includes("+"));
  expect(groups.length).toBeGreaterThan(1);
  for (const g of groups) {
    const apps = g.app.split("+");
    expect(apps.length).toBeLessThanOrEqual(6);
    expect(g.dir).toBe(".");
    for (const a of apps) {
      expect(APPS[a]!.prep ?? APPS[a]!.boot ?? false).toBe(false);
      expect(g.test).toContain(`${appDir(a)} 'bun test --bail`);
      expect(g.filters).toContain(`--filter ./${appDir(a)}`);
      expect(g.sparse).toContain(`/${appDir(a)}/`);
    }
  }
  // Every app with tests is in exactly one job or one set of lanes.
  const grouped = groups.flatMap((g) => g.app.split("+")), alone = new Set(rows.filter((r) => !r.app.includes("+")).map((r) => r.app));
  expect(new Set(grouped).size).toBe(grouped.length);
  for (const a of Object.keys(APPS).filter((n) => APPS[n]!.test || APPS[n]!.boot)) expect([a, grouped.includes(a) !== alone.has(a)]).toEqual([a, true]);
  // A long suite still gets its lanes; a tiny one with a native build gets one job, not three builds.
  expect(rows.filter((r) => r.app === "mythic-masters").length).toBe(3);
  expect(rows.filter((r) => r.app === "auto-rig").length).toBe(1);
});
