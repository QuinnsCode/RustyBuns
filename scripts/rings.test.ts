import { expect, test } from "bun:test";
import { rangeLine, sinceLastGreen, type Tested } from "./rings.ts";

const sha = (c: string) => c.repeat(40);
const [a, b, c, d] = ["a", "b", "c", "d"].map(sha) as [string, string, string, string];

test.each<[string, Tested[], { green?: string; shas: string[] }]>([
  // red at the head, two untested squash commits under it, then the green one
  ["red after a green", [{ sha: a, state: "FAILURE" }, { sha: b }, { sha: c }, { sha: d, state: "SUCCESS" }], { green: d, shas: [a, b, c] }],
  ["head is green", [{ sha: a, state: "SUCCESS" }, { sha: b, state: "FAILURE" }], { green: a, shas: [] }],
  ["an older red doesn't stop the walk", [{ sha: a, state: "FAILURE" }, { sha: b, state: "FAILURE" }, { sha: c, state: "SUCCESS" }], { green: c, shas: [a, b] }],
  ["no green in view", [{ sha: a, state: "FAILURE" }, { sha: b }], { shas: [a, b] }],
])("sinceLastGreen: %s", (_, history, want) => {
  expect(sinceLastGreen(history)).toEqual(want);
});

test("rangeLine links the compare view from the last green to the head", () => {
  expect(rangeLine("o/r", [{ sha: a, state: "FAILURE" }, { sha: b }, { sha: c, state: "SUCCESS" }]))
    .toBe(`Since the last green (ccccccc): 2 commits, https://github.com/o/r/compare/${c}...${a}`);
  expect(rangeLine("o/r", [{ sha: a, state: "FAILURE" }])).toBe("No green ring run in the last 1 commits; newest is aaaaaaa.");
});
