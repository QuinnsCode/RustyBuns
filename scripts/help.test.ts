import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import { usage } from "./help.ts";

setDefaultTimeout(30_000);
const root = resolve(import.meta.dir, "..");

describe("--help", () => {
  // The scripts agents grepped for their flags: each answers --help with its usage and exits before doing any work
  // (no gh calls, no Chrome, no Blender, no files written).
  test.each([
    ["scripts/probe.ts", "--list"],
    ["scripts/climbs.ts", "--next"],
    ["apps/mythic-masters/scripts/tune.ts", "--each"],
    ["apps/mythic-masters/scripts/beasts.ts", "--jobs"],
    ["apps/mythic-masters/scripts/dens.ts", "dens.json"],
  ])("%s", (file, mentions) => {
    for (const flag of ["--help", "-h"]) {
      const r = Bun.spawnSync(["bun", file, flag], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString()).toContain(mentions);
    }
  });

  test("usage is the leading comment, after any shebang, up to the first code line", () => {
    expect(usage("#!/usr/bin/env bun\n// Does a thing.\n//\n//   bun x.ts --flag\nimport a from 'b';\n// later\n")).toBe("Does a thing.\n\n  bun x.ts --flag");
    expect(usage("import a from 'b';\n")).toBe("");
  });
});
