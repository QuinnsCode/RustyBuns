import { expect, test } from "bun:test";
import { fixPrompt, scrub, worthAButton } from "../src/fix-prompt.ts";

test("the prompt hands back what happened and the error", () => {
  const p = fixPrompt({ what: "save a token", error: "boom", status: 500, method: "POST", path: "/tokens?x=1", page: "#/settings" }, { site: "https://cs.example", version: "0.1.10" });
  expect(p).toContain("What I was doing: save a token");
  expect(p).toContain("Call: POST /api/tokens -> 500");
  expect(p).toContain("    boom");
  expect(p).toContain("fork https://github.com/QuinnsCode/RustyBuns");
  expect(p).not.toContain("x=1");
});

test("secrets are scrubbed everywhere", () => {
  const tok = "cst_abcdefghijklmnopqrstuvwx";
  const p = fixPrompt({ what: `use ${tok}`, error: `Authorization: Bearer ${tok}\nGET https://a.b/c?token=${tok}`, notes: [`cookie: cs_user=me`] });
  expect(p).not.toContain(tok);
  expect(p).not.toContain("cs_user=me");
  expect(scrub("https://a.b/c?q=1#h")).toBe("https://a.b/c#h");
});

test("a merge failure points at Mervin", () => {
  const p = fixPrompt({ what: "merge feature-x", error: "conflicts", kind: "merge", notes: ["src/a.ts:12 both sides edited"] });
  expect(p).toContain("Mervin");
  expect(p).toContain("src/a.ts:12");
});

test("only server faults and uncaught errors get a button", () => {
  expect(worthAButton(500)).toBe(true);
  expect(worthAButton(undefined)).toBe(true);
  expect(worthAButton(403)).toBe(false);
});
