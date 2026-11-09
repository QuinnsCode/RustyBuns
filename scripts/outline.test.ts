import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api, outline, render, show } from "./outline.ts";

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

test("--api prints each entry point's exports as one-line signatures, no bodies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "outline-api-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fx", exports: { ".": "./index.ts", "./box": { import: "./box.ts" } } }));
  writeFileSync(join(dir, "index.ts"), `${src}export { Box };\nexport { other } from "./other.ts";\n`);
  writeFileSync(join(dir, "box.ts"), `/** A box. */\nexport class Crate {\n  #lid = 0;\n  /** Puts one in. */\n  put(n: number): void {\n    this.#lid += n;\n  }\n  private peek() {\n    return 1;\n  }\n}\n`);
  const lines = (await api(dir)).map((l) => l.replace(dir, "<pkg>"));
  expect(lines).toEqual([
    "<pkg>/index.ts",
    "  function add(a: number, b: number)  // Adds two numbers.",
    "  const next = (n: number) =>  // A seeded counter.",
    "  type Id = string",
    "  class Box",
    "    open()  // Opens it.",
    `  export other from "./other.ts"`,
    "<pkg>/box.ts  (./box)",
    "  class Crate  // A box.",
    "    put(n: number): void  // Puts one in.",
  ]);
});
