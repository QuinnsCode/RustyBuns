import { expect, test } from "bun:test";
import { laneCommands, sharedCode } from "./ci-apps.ts";

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
  // Flags and their values stay; the folder they ran over goes, since each lane names its files.
  expect(laneCommands("bun test --parallel --timeout 30000 test", ms({ "test/a.test.ts": 1 }), 3))
    .toEqual(["bun test --parallel --timeout 30000 ./test/a.test.ts"]);
});
