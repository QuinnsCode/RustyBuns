import { expect, test } from "bun:test";
import { aotName, hasAot } from "../scripts/aot.ts";

test("--aot is found only as a flag of its own in bun build --help", () => {
  expect(hasAot("      --compile        Generate a standalone Bun executable\n      --aot            Compile ahead of time\n")).toBe(true);
  expect(hasAot("      --compile        Generate a standalone Bun executable\n      --compile-jit-policy=<val>  JIT tier-up\n")).toBe(false);
  expect(hasAot("      --aot-harden=<val>  hardening\n")).toBe(false);
  expect(aotName("dist/agent-office-darwin-arm64")).toBe("dist/agent-office-darwin-arm64-aot");
});
