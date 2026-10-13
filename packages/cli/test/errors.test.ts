import { expect, test } from "bun:test";
import { ConfigLoadFailed, UsageError, closest, flag, intFlag, renderError, triagePrompt } from "../src/errors.ts";

test("tagged errors print as one line with their tag; usage exits 2", () => {
  expect(renderError(new UsageError({ message: "--seconds needs a value" }))).toEqual({ text: "✗ [UsageError] --seconds needs a value", code: 2 });
  expect(renderError(new ConfigLoadFailed({ message: "no rustybuns.config.ts here" })).code).toBe(1);
  expect(renderError(new Error("a written message"))).toEqual({ text: "✗ a written message", code: 1 });
});

test("a TypeError is a bug and says where it was thrown", () => {
  const crash = (c: any) => c.targets.edge;
  let e: unknown;
  try { crash({}); } catch (err) { e = err; }
  const { text } = renderError(e, process.cwd());
  expect(text).toStartWith("✗ [Bug] ");
  expect(text).toMatch(/\n  at (packages\/cli\/)?test\/errors\.test\.ts:\d+:\d+/);
});

test("flags: a missing or bad value is a usage error, not the default", () => {
  expect(flag(["--url", "http://x"], "url")).toBe("http://x");
  expect(flag([], "url")).toBeUndefined();
  expect(() => flag(["--url", "--json"], "url")).toThrow("--url needs a value");
  expect(intFlag([], "seconds", 1, 60, 10)).toBe(10);
  expect(() => intFlag(["--seconds", "ten"], "seconds", 1, 60, 10)).toThrow('got "ten"');
  expect(() => intFlag(["--top", "0"], "top", 1, 1000, 10)).toThrow("from 1 to 1000");
});

test("closest: did you mean", () => {
  expect(closest("deploi", ["deploy", "destroy", "dev"])).toBe("deploy");
  expect(closest("zzzzzz", ["deploy"])).toBeUndefined();
});

test("triagePrompt: a paste-ready block with the command and error, tokens scrubbed", () => {
  const out = triagePrompt("✗ [AlchemyFailed] alchemy deploy exited 1 token cfut_abcdefghijklmnop1234", { argv: ["deploy", "--stage", "prod"], version: "1.2.3", platform: "darwin" });
  expect(out).toContain("`rustybuns deploy --stage prod` (rustybuns 1.2.3, darwin)");
  expect(out).toContain("[AlchemyFailed]");
  expect(out).toContain("<redacted>");
  expect(out).not.toContain("cfut_abcdefghijklmnop1234");
  expect(out).toContain("rustybuns triage");
});
