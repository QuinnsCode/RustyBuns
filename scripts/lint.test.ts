import { expect, test } from "bun:test";
import { compare, count, findings } from "./lint.ts";

const at = (filename: string, code: string, line: number) => ({ code, message: "m", filename, labels: [{ span: { line } }] });

test("a new finding fails, a fixed one asks for a lower allowance, the same count passes", () => {
  const all = findings({ diagnostics: [at("./a.ts", "eslint(no-eval)", 3), at("./a.ts", "anti-slop(no-reflect-get)", 9)] });
  expect(all.map((f) => f.rule)).toEqual(["no-eval", "anti-slop/no-reflect-get"]);
  const now = count(all);
  expect(compare(now, now, all)).toEqual([]);
  const [more] = compare(now, { "a.ts": { "no-eval": 1 } }, all);
  expect(more).toContain("a.ts: 1 × anti-slop/no-reflect-get, 0 allowed");
  expect(more).toContain("9  m");
  expect(compare({}, { "a.ts": { "no-eval": 1 } }, [])).toEqual(["a.ts: 0 × no-eval left, 1 allowed: run bun run lint --update, so the allowance only goes down"]);
});

test("a report that isn't oxlint's shape is refused", () => {
  expect(() => findings({ diagnostics: [{ code: 1 }] })).toThrow();
});
