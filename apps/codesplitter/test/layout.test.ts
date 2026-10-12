import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP, heal, layout } from "../layout.ts";

// REFERENCE.md's Layout table used to be a hand-kept list that every new module appended to in the
// same spot (#988). Now each file says its own row on its first line, and this keeps the table in step.
test("REFERENCE.md's Layout table matches the files' own Layout lines (run `bun run layout`)", () => {
  const reference = readFileSync(join(APP, "REFERENCE.md"), "utf8");
  expect(heal(reference, layout())).toBe(reference);
});

const app = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), "layout-"));
  mkdirSync(join(d, "src/sub"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);
  return d;
};

test("a file's first line makes its row, a list makes one row for several, rows sort by first path", () => {
  const d = app({
    "z.ts": "// Layout: the last | one\n",
    "src/b.ts": "// Layout (src/b.ts, src/c.ts): b and c\n",
    "src/c.ts": "// no row of its own\n",
    "src/sub/a.ts": "// Layout: nested\n",
    "src/late.ts": "export {};\n// Layout: not on the first line, so no row\n",
  });
  const rows = layout(d);
  expect(rows).toEqual([
    { files: ["src/b.ts", "src/c.ts"], what: "b and c" },
    { files: ["src/sub/a.ts"], what: "nested" },
    { files: ["z.ts"], what: "the last | one" },
  ]);
  expect(heal("## Layout\n\n| File | What |\n|---|---|\n| old | row |\n\nafter\n", rows)).toBe(
    "## Layout\n\n| File | What |\n|---|---|\n| `src/b.ts`, `src/c.ts` | b and c |\n| `src/sub/a.ts` | nested |\n| `z.ts` | the last \\| one |\n\nafter\n",
  );
});

test("a Layout line naming a missing file, or a reference with no table, throws", () => {
  expect(() => layout(app({ "a.ts": "// Layout (a.ts, gone.ts): a\n" }))).toThrow("gone.ts");
  expect(() => heal("# no layout here\n", [])).toThrow("## Layout");
});
