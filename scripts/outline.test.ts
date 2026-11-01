import { expect, test } from "bun:test";
import { outline, render, show } from "./outline.ts";

const src = `import x from "y";
/** Adds two numbers.
 * More. */
export function add(a: number, b: number) {
  return a + b;
}
// A seeded counter.
export const next = (n: number) => n + 1;
const LIMIT = 5;
export type Id = string;
class Box {
  /** Opens it. */
  open() {
    return 1;
  }
}
`;

test("lists each top-level declaration with its line range and first doc line", () => {
  expect(render(outline(src), "f.ts")).toEqual([
    "f.ts",
    " 4-6   export function add  // Adds two numbers.",
    " 8     export function next  // A seeded counter.",
    " 9     const LIMIT",
    "10     export type Id",
    "11-16  class Box",
    "13-15    method open  // Opens it.",
  ]);
});

test("a name prints that symbol's numbered source; an unknown name is null", () => {
  const e = outline(src);
  expect(show(src, e, "add")?.[0]).toBe("    4  export function add(a: number, b: number) {");
  expect(show(src, e, "nope")).toBeNull();
});
