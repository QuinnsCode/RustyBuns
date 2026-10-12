import { describe, expect, test } from "bun:test";
import { shadow } from "../scripts/shadow.ts";

// scripts/shadow.ts (#1014): codeSplitter's merge beside git's, one file's three versions at a time.
describe("shadow mode", () => {
  test("the same clean merge both ways agrees", () => {
    const s = shadow("a.ts", "a\nb\nc\nd\ne\n", "A\nb\nc\nd\ne\n", "a\nb\nc\nd\nE\n");
    expect(s.verdict).toBe("agree");
    expect(s.git.text).toBe("A\nb\nc\nd\nE\n");
  });

  test("lines changed next to each other: git conflicts, a merge by line id doesn't, and what landed is checked", () => {
    const s = shadow("a.ts", "a\nb\nc\n", "A\nb\nc\n", "a\nB\nc\n", "", "A\nB\nc\n");
    expect(s.verdict).toBe("git-only");
    expect(s.ours.text).toBe("A\nB\nc\n");
    expect(s.landed).toEqual({ git: false, ours: true, off: 0, reordered: false });
  });

  test("a resolution that only put the lines in another order says so", () => {
    const s = shadow("n.md", "a\n", "a\nmain\n", "a\nbranch\n", "", "a\nbranch\nmain\n");
    expect(s.verdict).toBe("git-only");
    expect(s.landed).toMatchObject({ ours: false, reordered: true });
  });

  test("the same line added in two places: git lands it twice, ours asks (#244's .gitignore)", () => {
    const s = shadow(".gitignore", ".env\n.env.*\n!.env.example\n.dev.vars\n", ".env\n.env.*\n!.env.schema\n!.env.example\n.dev.vars\n", ".env\n.env.*\n!.env.example\n!.env.schema\n.dev.vars\n");
    expect(s.verdict).toBe("ours-only");
    expect(s.git.text).toBe(".env\n.env.*\n!.env.schema\n!.env.example\n!.env.schema\n.dev.vars\n");
    expect(s.ours.conflicts).toMatchObject([{ doubled: true, main: "!.env.schema", branch: "!.env.schema" }]);
  });

  test("a merge git calls clean that declares a name twice trips the lint guard", () => {
    const base = "export const a = 1;\n\n\n\nexport const b = 2;\n";
    const s = shadow("x.ts", base, `const x = 1;\n${base}`, `${base}const x = 2;\n`);
    expect(s.git.clean).toBe(true);
    expect(s.verdict).toBe("guard");
    expect(s.ours.conflicts.map((c) => c.line)).toEqual(["lint:redeclared:x"]);
  });

  test("a lockfile both changed is a conflict by design, not a gap", () => {
    const s = shadow("bun.lock", "a\nb\nc\nd\n", "A\nb\nc\nd\n", "a\nb\nc\nD\n");
    expect(s.git.clean).toBe(true);
    expect(s.verdict).toBe("lock");
  });

  test("both conflict", () => {
    expect(shadow("a.ts", "foo(1)\n", "foo(2)\n", "foo(3)\n").verdict).toBe("both");
  });
});
