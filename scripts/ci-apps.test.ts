import { expect, test } from "bun:test";
import { sharedCode } from "./ci-apps.ts";

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
