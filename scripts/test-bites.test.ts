import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addedLines, changedTests, passesOnBase, ranges, unrunLines } from "./test-bites.ts";

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

test("a fix in a workspace package, tested from an app: the base run uses the base's package, and --lines finds what nobody ran", async () => {
  const repo = mkdtempSync(join(tmpdir(), "bites-ws-"));
  const git = (...args: string[]) => Bun.$`git -c user.name=t -c user.email=t@t ${args}`.cwd(repo).quiet();
  const write = (f: string, s: string) => (mkdirSync(dirname(join(repo, f)), { recursive: true }), writeFileSync(join(repo, f), s));
  await git("init", "-q", "-b", "main");
  write(".gitignore", "node_modules\n");
  write("packages/lib/package.json", `{"name":"lib","type":"module","main":"index.ts"}`);
  write("packages/lib/index.ts", "export const two = () => 3;\n");
  write("app/package.json", `{"name":"app","type":"module"}`);
  mkdirSync(join(repo, "app/node_modules"));
  symlinkSync("../../packages/lib", join(repo, "app/node_modules/lib")); // as bun install links a workspace package
  await git("add", "."), await git("commit", "-qm", "buggy lib");
  const base = (await git("rev-parse", "HEAD")).text().trim();

  write("packages/lib/index.ts", "export const two = () => 2;\nexport function unused() {\n  return 1;\n}\n");
  write("app/two.test.ts", `import { expect, test } from "bun:test";\nimport { two } from "lib";\ntest("two", () => expect(two()).toBe(2));\n`);

  const files = await changedTests(repo, base);
  expect(await passesOnBase(repo, base, files)).toEqual([]);
  const unrun = (await unrunLines(repo, base, files)).get("packages/lib/index.ts");
  // Line 1 ran; Bun marks the never-called function by its declaration or its body (2-4).
  expect(Array.isArray(unrun) && unrun.length > 0 && unrun.every((n) => n >= 2 && n <= 4)).toBe(true);
});

test("reads the new side of a -U0 diff", () => {
  const diff = ["+++ b/a.ts", "@@ -1 +1 @@", "@@ -5,0 +6,3 @@", "@@ -9,2 +11,0 @@", "+++ /dev/null", "@@ -1,4 +0,0 @@"].join("\n");
  expect([...addedLines(diff)]).toEqual([["a.ts", [1, 6, 7, 8]]]);
  expect(ranges([1, 6, 7, 8, 10])).toBe("1, 6-8, 10");
});
