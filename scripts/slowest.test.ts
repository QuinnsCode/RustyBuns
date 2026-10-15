import { expect, test } from "bun:test";
import { slowest } from "./slowest.ts";

test("testcases come back slowest first, names unescaped", () => {
  const xml = `<testsuite><testcase name="a &amp; b" classname="x" file="test/a.test.ts" time="0.5"/><testcase name="slow" file="test/b.test.ts" time="12.25"></testcase></testsuite>`;
  expect(slowest(xml)).toEqual([{ file: "test/b.test.ts", name: "slow", s: 12.25 }, { file: "test/a.test.ts", name: "a & b", s: 0.5 }]);
});
