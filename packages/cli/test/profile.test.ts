import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Profiler, formatProfile, type ProfileRun } from "../src/profile.ts";
import { checkFlags, checkCommand, pickChecker, stackTsconfig, wantsEffectDiagnostics } from "../src/typecheck.ts";

test("profiler: records each step in order, failed steps included", async () => {
  const p = new Profiler("plan");
  expect(await p.step("generate", () => 1)).toBe(1);
  await expect(p.step("typecheck stack", () => { throw new Error("boom"); }, "bun")).rejects.toThrow("boom");
  expect(p.steps.map((s) => s.name)).toEqual(["generate", "typecheck stack"]);
  expect(p.steps[1]!.note).toBe("bun, failed");
});

test("formatProfile: per-step deltas and speedup against the previous run", () => {
  const prev: ProfileRun = { command: "plan", at: "", bun: "1.4.2", totalMs: 6000, steps: [{ name: "typecheck stack", ms: 3000, note: "tsc" }, { name: "alchemy plan", ms: 3000 }] };
  const now: ProfileRun = { command: "plan", at: "", bun: "1.4.3", totalMs: 3200, steps: [{ name: "typecheck stack", ms: 200, note: "bun" }, { name: "alchemy plan", ms: 3000 }] };
  const out = formatProfile(now, prev);
  expect(out).toContain("typecheck stack    200ms    6%  -2.80s (15.0x faster)  [bun]");
  expect(out).toContain("alchemy plan       3.00s   94%  =");
  expect(out).toMatch(/total\s+3\.20s\s+-2\.80s \(1\.9x faster\)/);
  expect(formatProfile(now)).not.toContain("faster");
});

test("checkFlags: --check / --no-check / --checker, other args pass through", () => {
  expect(checkFlags(["--stage", "dev"], true)).toEqual({ on: true, checker: "auto", rest: ["--stage", "dev"] });
  expect(checkFlags(["--no-check", "--yes"], true)).toEqual({ on: false, checker: "auto", rest: ["--yes"] });
  expect(checkFlags(["--checker", "tsc-rs"], false)).toEqual({ on: true, checker: "tsc-rs", rest: [] });
  expect(checkFlags(["--checker=bun", "--target", "linux-x64"], false).rest).toEqual(["--target", "linux-x64"]);
  expect(() => checkFlags(["--checker", "swc"], false)).toThrow("--checker");
});

test("checker commands and the Effect-plugin preference", () => {
  expect(checkCommand({ name: "bun", bin: "bun" }, "a/tsconfig.json")).toEqual(["bun", "check", "-p", "a/tsconfig.json"]);
  expect(checkCommand({ name: "bun", bin: "bun" }, null)).toEqual(["bun", "check"]);
  expect(checkCommand({ name: "tsc-rs", bin: "tsc-rs" }, "t.json")).toEqual(["tsc-rs", "-p", "t.json", "--noEmit"]);
  expect(() => checkCommand({ name: "tsc", bin: "tsc" }, null)).toThrow("tsconfig");

  const dir = mkdtempSync(join(tmpdir(), "rb-check-"));
  writeFileSync(join(dir, "tsconfig.json"), stackTsconfig());
  expect(wantsEffectDiagnostics(join(dir, "tsconfig.json"))).toBe(true);
  expect(JSON.parse(stackTsconfig()).files).toEqual(["alchemy.run.ts"]);
  // An explicit checker that is not there is an error with the fix in it.
  const prev = process.env.RB_BUN; delete process.env.RB_BUN;
  try {
    if (!Bun.semver.satisfies(Bun.version, ">=1.4.3")) expect(() => pickChecker("bun", null)).toThrow("bun upgrade");
  } finally { if (prev !== undefined) process.env.RB_BUN = prev; }
});
