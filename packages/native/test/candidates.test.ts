import { expect, test } from "bun:test";
import { candidates, isCompiled } from "../src/index.ts";

const fromCwd = (paths: string[]) => paths.filter(p => p.startsWith(process.cwd()));

test("dev runs look in native/dist under the current folder", () => {
  expect(fromCwd(candidates("demo", {}, "/repo/packages/native/src")).length).toBe(1);
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
