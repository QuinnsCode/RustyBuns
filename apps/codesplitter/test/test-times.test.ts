import { expect, test } from "bun:test";
import { timesOf } from "../scripts/test-times.ts";

test("a JUnit report becomes total ms per test file", () => {
  const xml = `<testsuites>
    <testcase name="a" classname="x" file="test/one.test.ts" time="0.250"/>
    <testcase name="b" classname="x" file="test/one.test.ts" time="1.000"/>
    <testcase name="c" classname="y" file="test/two.test.ts" time="0.040"/>
  </testsuites>`;
  expect(timesOf(xml)).toEqual({ "test/one.test.ts": 1250, "test/two.test.ts": 40 });
});
