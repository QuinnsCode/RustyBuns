import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidates, isCompiled, projectDirs } from "../src/index.ts";

const fromCwd = (paths: string[]) => paths.filter(p => p.startsWith(process.cwd()));
const tmp = mkdtempSync(join(tmpdir(), "rb-native-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test("dev runs look in native/dist beside the entry script, up to its package.json", () => {
  const app = join(tmp, "app");
  mkdirSync(join(app, "src"), { recursive: true });
  writeFileSync(join(app, "package.json"), "{}");
  expect(projectDirs(join(app, "src", "main.ts"))).toEqual([join(app, "src"), app]);
  const c = candidates("demo", {}, "/repo/packages/native/src", join(app, "src", "main.ts"));
  expect(c.slice(0, 2).map(p => p.split("/native/dist/")[0])).toEqual([join(app, "src"), app]);
});

test("dev runs never look in the current folder", () => {
  const elsewhere = mkdtempSync(join(tmp, "cwd-"));
  const app = join(tmp, "app2");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "package.json"), "{}");
  const was = process.cwd();
  process.chdir(elsewhere);
  try {
    expect(fromCwd(candidates("demo", {}, "/repo/packages/native/src", join(app, "main.ts")))).toEqual([]);
  } finally { process.chdir(was); }
});

test("compiled binaries never look in the current folder", () => {
  for (const here of ["/$bunfs/root", "B:\\~BUN\\root"]) {
    expect(isCompiled(here)).toBe(true);
    const c = candidates("demo", {}, here);
    expect(fromCwd(c)).toEqual([]);
    expect(c.every(p => p.startsWith("/$bunfs/root"))).toBe(true);
  }
});

test("compiled binaries still honour an explicit opts.dir", () => {
  expect(candidates("demo", { dir: "/opt/libs" }, "/$bunfs/root")[0]).toStartWith("/opt/libs/");
});
