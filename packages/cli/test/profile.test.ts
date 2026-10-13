import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Profiler, formatProfile, type ProfileRun } from "../src/profile.ts";
import { checkFlags, checkCommand, compactDiagnostics, fromDir, hasBunCheck, pickChecker, runCheck, stackTsconfig, wantsEffectDiagnostics } from "../src/typecheck.ts";

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
  expect(checkCommand({ name: "bun", bin: "bun" }, "a/tsconfig.json")).toEqual(["bun", "check", "-p", "a/tsconfig.json", "--no-pretty"]);
  expect(checkCommand({ name: "bun", bin: "bun" }, null)).toEqual(["bun", "check", "--no-pretty"]);
  expect(checkCommand({ name: "tsc", bin: "tsc" }, "t.json")).toEqual(["tsc", "-p", "t.json", "--noEmit", "--pretty", "false"]);
  expect(checkCommand({ name: "tsc-rs", bin: "tsc-rs" }, "t.json")).toEqual(["tsc-rs", "-p", "t.json", "--noEmit"]);
  expect(() => checkCommand({ name: "tsc", bin: "tsc" }, null)).toThrow("tsconfig");

  const dir = mkdtempSync(join(tmpdir(), "rb-check-"));
  writeFileSync(join(dir, "tsconfig.json"), stackTsconfig());
  expect(wantsEffectDiagnostics(join(dir, "tsconfig.json"))).toBe(true);
  expect(JSON.parse(stackTsconfig()).files).toEqual(["alchemy.run.ts"]);
  // An explicit checker that is not there is an error with the fix in it.
  const prev = process.env.RB_BUN; delete process.env.RB_BUN;
  try {
    if (!hasBunCheck(Bun.version)) expect(() => pickChecker("bun", null)).toThrow("bun upgrade");
  } finally { if (prev !== undefined) process.env.RB_BUN = prev; }
});

test("bun check: 1.4.3 and its canaries have it, 1.4.2 doesn't", () => {
  expect(["1.4.2", "1.4.3-canary.12+abc", "1.4.3", "1.5.0"].map(hasBunCheck)).toEqual([false, true, true, true]);
});

test("compactDiagnostics: one short line per error, location first, capped", () => {
  const long = "x".repeat(1000);
  const out = [
    "\x1b[31msrc/a.ts(2,34): error TS2322: Type 'number' is not assignable to type 'string'.\x1b[0m",
    `src/b.ts(9,1): error TS2345: Argument of type 'Effect<${long}>' is not assignable.`,
    "  Type 'A' is not assignable to type 'B'.",
    "Found 2 errors in 2 files",
  ].join("\n");
  const lines = compactDiagnostics(out).split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe("src/a.ts(2,34): error TS2322: Type 'number' is not assignable to type 'string'.");
  expect(lines[1]!.startsWith("src/b.ts(9,1): error TS2345")).toBe(true);
  expect(lines[1]!.length).toBe(300);
  const many = Array.from({ length: 25 }, (_, i) => `f.ts(${i},1): error TS1: e`).join("\n");
  expect(compactDiagnostics(many, 20).split("\n").at(-1)).toBe("… +5 more");
});

test("bun check type checks even when the app has a \"check\" script of its own", async () => {
  // Bun runs package.json scripts ahead of its built-ins: `bun check` ran an app's lint script and passed
  const dir = mkdtempSync(join(tmpdir(), "rb-check-script-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { check: "echo app script ran" } }));
  writeFileSync(join(dir, "a.ts"), 'const n: number = "x";\nconsole.log(n);\n');
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: ["a.ts"] }));
  const was = process.cwd();
  process.chdir(dir);
  try {
    const r = await runCheck({ name: "bun", bin: process.execPath }, "tsconfig.json");
    expect(r.output).not.toContain("app script ran");
    expect(r.ok).toBe(false);
    expect(r.output).toContain("a.ts(1,7)");
  } finally { process.chdir(was); }
});

test("fromDir: diagnostics printed elsewhere come back relative to here", () => {
  expect(fromDir("../app/src/a.ts(1,7): error TS2322: nope\nFound 1 error", "/tmp/x", "/tmp/app")).toBe("src/a.ts(1,7): error TS2322: nope\nFound 1 error");
});
