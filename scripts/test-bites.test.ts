import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addedLines, changedTests, inertFiles, mutate, onlyTests, passesOnBase, ranges, survivors, unrunLines } from "./test-bites.ts";

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

  // a fix with its tests has source to bite on; tidying only the tests after it has none, so nothing is run on the base
  expect(await onlyTests(repo, base)).toBe(false);
  const fixed = (await git("rev-parse", "HEAD")).text().trim();
  writeFileSync(join(repo, "nothing.test.ts"), t("expect(add(3, 0)).toBe(3);"));
  expect(await onlyTests(repo, fixed)).toBe(true);
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
  // out of time: no file starts, each is named, and what it would have run reads as never loaded
  const late: string[] = [];
  expect((await unrunLines(repo, base, files, Date.now() - 1, late)).get("packages/lib/index.ts")).toBe("unloaded");
  expect(late).toEqual(files);
});

test("reads the new side of a -U0 diff", () => {
  const diff = ["+++ b/a.ts", "@@ -1 +1 @@", "@@ -5,0 +6,3 @@", "@@ -9,2 +11,0 @@", "+++ /dev/null", "@@ -1,4 +0,0 @@"].join("\n");
  expect([...addedLines(diff)]).toEqual([["a.ts", [1, 6, 7, 8]]]);
  expect(ranges([1, 6, 7, 8, 10])).toBe("1, 6-8, 10");
});

test("--mutate: a flip the tests check is caught, one they only run survives, and the working tree is left alone", async () => {
  const repo = mkdtempSync(join(tmpdir(), "bites-mut-"));
  const git = (...args: string[]) => Bun.$`git -c user.name=t -c user.email=t@t ${args}`.cwd(repo).quiet();
  await git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "price.ts"), "export const total = (a: number) => a;\n");
  await git("add", "."), await git("commit", "-qm", "base");
  const base = (await git("rev-parse", "HEAD")).text().trim();

  const src = "export const total = (a: number, b: number) => a + b;\nexport const free = (a: number) => a === 0;\n";
  writeFileSync(join(repo, "price.ts"), src); // uncommitted: the scratch copy must carry it
  writeFileSync(join(repo, "price.test.ts"), `import { expect, test } from "bun:test";\nimport { free, total } from "./price.ts";\ntest("x", () => { expect(total(2, 3)).toBe(5); free(0); });\n`);

  const r = await survivors(repo, base, ["price.test.ts"]);
  expect(r).toEqual({ tried: 2, survived: [{ file: "price.ts", line: 2, now: "export const free = (a: number) => a !== 0;" }] });
  expect(await Bun.file(join(repo, "price.ts")).text()).toBe(src);
  expect((await git("worktree", "list")).text().trim().split("\n")).toHaveLength(1);
});

test("mutate flips one operator, outside quotes, comments and imports", () => {
  const rows: [string, string | undefined][] = [
    ["if (a === b && c) {", "if (a !== b && c) {"],
    ["for (let i = 0; i < n; i++) {", "for (let i = 0; i >= n; i++) {"],
    ["const m = new Map<string, number>(); const f = (x) => x - 1;", "const m = new Map<string, number>(); const f = (x) => x + 1;"],
    [`log("a === b", ok || bad);`, `log("a === b", ok && bad);`],
    ["  // if (a === b)", undefined],
    [`import { a } from "./b.ts";`, undefined],
    ["const s = \"done\";", undefined],
  ];
  for (const [line, want] of rows) expect(mutate(line)).toBe(want);
});

test("a test file whose diff only touches timeouts, comments or blank lines is skipped; any other line runs it", () => {
  const diff = (minus: string, plus: string) => `diff --git a/x.test.ts b/x.test.ts\n--- a/x.test.ts\n+++ b/x.test.ts\n@@ -3 +3 @@\n-${minus}\n+${plus}\n`;
  const cases: [string, string, boolean][] = [
    ["setDefaultTimeout(60_000);", "setDefaultTimeout(30_000);", true],
    ["setDefaultTimeout(60_000);", "setDefaultTimeout(60_000); // builds the page in headless Chrome", true],
    ["// old words", "// new words", true],
    [" * a doc line", " * another", true],
    ["", "", true],
    ["expect(add(2, 2)).toBe(4);", "expect(add(2, 2)).toBe(5);", false],
    ["setDefaultTimeout(60_000);", "setDefaultTimeout(ms);", false],
    ["// a comment", "const x = 1; // a comment", false],
  ];
  for (const [minus, plus, inert] of cases) expect(inertFiles(diff(minus, plus)).has("x.test.ts")).toBe(inert);
  // two files in one diff: only the one with no test body changed is inert
  expect([...inertFiles(diff("// a", "// b") + diff("a()", "b()").replaceAll("x.test.ts", "y.test.ts"))]).toEqual(["x.test.ts"]);
});
