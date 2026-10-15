import { describe, expect, test } from "bun:test";
import { leakIn } from "../src/leaks.ts";

describe("private lines the agent read (#1569)", () => {
  const before = ["public intro", "the vault code is 48151623", "tail"];
  const hidden = ["the vault code is 48151623"];

  test("a copy of a private line in a new comment is refused", () => {
    expect(leakIn(before, [...before, "// the vault code is 48151623"], [], hidden)).toBe("a private line copied into a public one");
  });
  test("the private line left alone, or edited in place, is fine", () => {
    expect(leakIn(before, before, [], hidden)).toBeNull();
    expect(leakIn(before, ["public intro", "the vault code is 48151623 (rotated)", "tail"], [], hidden)).toBeNull();
  });
  test("a private line copied into another file the run edits is refused", () => {
    const other = ["export const x = 1"];
    expect(leakIn(other, [...other, "// the vault code is 48151623"], [], hidden)).toBe("a private line copied into a public one");
  });
  test("a short private line isn't checked", () => {
    expect(leakIn(["ok", "no"], ["ok", "no", "no"], [], ["no"])).toBeNull();
  });
});
