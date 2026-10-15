import { expect, test } from "bun:test";
import { httpUrl, parseJson } from "../src/util.ts";
import { MAX_OPS, parseOps } from "../src/lines.ts";

test("parseJson: a stored value that isn't JSON is the fallback, not a throw", () => {
  expect(parseJson<string[]>('["a"]', [])).toEqual(["a"]);
  expect(parseJson<string[]>("{oops", [])).toEqual([]);
  expect(parseJson<string[]>(null, [])).toEqual([]);
  expect(parseJson<string[]>("", ["kept"])).toEqual(["kept"]);
});

test("httpUrl: http(s) only, short enough to store", () => {
  expect(httpUrl("https://ci.example/run/1")).toBe("https://ci.example/run/1");
  expect(httpUrl("javascript:alert(1)")).toBeNull();
  expect(httpUrl("data:text/html,hi")).toBeNull();
  expect(httpUrl("not a url")).toBeNull();
  expect(httpUrl(5)).toBeNull();
  expect(httpUrl(`https://x/${"a".repeat(3000)}`)).toBeNull();
});

test("parseOps: the three kinds with their fields, one line per text, a cap on the batch", () => {
  const ok = [{ kind: "insert", after: null, text: "a" }, { kind: "set", line: "L1", base: 1, text: "b" }, { kind: "delete", line: "L2", base: 2 }];
  expect(parseOps(ok)).toBe(ok);
  expect(parseOps(undefined)).toMatch(/^ops:/);
  expect(parseOps([{ kind: "insert", after: null, text: 5 }])).toMatch(/^ops\[0\]: text/);
  expect(parseOps([{ kind: "insert", after: null, text: "a\nb" }])).toMatch(/text: one line/);
  expect(parseOps([{ kind: "insert", after: 3, text: "a" }])).toMatch(/after/);
  expect(parseOps([{ kind: "replace", line: "L1", base: 1 }])).toMatch(/kind: insert, set or delete/);
  expect(parseOps([{ kind: "delete", line: 1, base: 1 }])).toMatch(/line: a line id/);
  expect(parseOps([{ kind: "set", line: "L1", base: 1.5, text: "x" }])).toMatch(/base/);
  expect(parseOps([null])).toMatch(/an object/);
  expect(parseOps(Array.from({ length: MAX_OPS + 1 }, () => ({ kind: "insert", after: null, text: "" })))).toMatch(/at most/);
});
