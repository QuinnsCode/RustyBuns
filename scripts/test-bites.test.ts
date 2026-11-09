import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedTests, passesOnBase } from "./test-bites.ts";

setDefaultTimeout(30_000);

test("a branch's new tests: the one that fails on the old code bites, the one that passes there proves nothing", async () => {
  const repo = mkdtempSync(join(tmpdir(), "bites-repo-"));
  const git = (...args: string[]) => Bun.$`git -c user.name=t -c user.email=t@t ${args}`.cwd(repo).quiet();
  await git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "add.ts"), "export const add = (a: number, b: number) => a - b;\n");
  await git("add", "."), await git("commit", "-qm", "buggy add");
  const base = (await git("rev-parse", "HEAD")).text().trim();

  writeFileSync(join(repo, "add.ts"), "export const add = (a: number, b: number) => a + b;\n");
  const t = (body: string) => `import { expect, test } from "bun:test";\nimport { add } from "./add.ts";\ntest("x", () => { ${body} });\n`;
  writeFileSync(join(repo, "bites.test.ts"), t("expect(add(2, 2)).toBe(4);"));
  writeFileSync(join(repo, "nothing.test.ts"), t("expect(add(2, 0)).toBe(2);"));
  await git("add", "."), await git("commit", "-qm", "fix add, with tests");

  const files = await changedTests(repo, base);
  expect(files.sort()).toEqual(["bites.test.ts", "nothing.test.ts"]);
  expect(await passesOnBase(repo, base, files)).toEqual(["nothing.test.ts"]);
  expect((await git("worktree", "list")).text().trim().split("\n")).toHaveLength(1);
  expect(readdirSync(repo).sort()).toEqual([".git", "add.ts", "bites.test.ts", "nothing.test.ts"]);
});
