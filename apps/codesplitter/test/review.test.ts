import { describe, expect, test } from "bun:test";
import { apply, empty, fromText, text, type Doc, type Op } from "../src/lines.ts";
import { hunks, revertOps } from "../src/review.ts";

// A file and a branch forked from it, ids and revs intact.
const fork = (src: string) => { const base = empty(); apply(base, fromText(src), "ana"); return { base, branch: structuredClone(base) as Doc }; };
const edit = (d: Doc, ops: Op[]) => { const r = apply(d, ops, "agent-a"); if (!r.ok) throw new Error(JSON.stringify(r.conflicts)); };
const rev = (d: Doc, id: string) => d.lines.find((l) => l.id === id)!.rev;

describe("a branch's change, a hunk at a time (#735)", () => {
  test("each stretch the branch changed is one hunk, with where it starts", () => {
    const { base, branch } = fork("a\nb\nc\nd\ne");
    edit(branch, [
      { kind: "set", line: "L2", base: rev(branch, "L2"), text: "B" },
      { kind: "insert", after: "L2", text: "b2" },
      { kind: "delete", line: "L4", base: rev(branch, "L4") },
    ]);
    const hs = hunks(base, branch);
    expect(hs.map((h) => ({ key: h.key, at: h.at, from: h.from, before: h.before, del: h.del.map((l) => l.text), add: h.add.map((l) => l.text) }))).toEqual([
      { key: "L2", at: 2, from: 2, before: "L1", del: ["b"], add: ["B", "b2"] },
      { key: "L4", at: 5, from: 4, before: "L3", del: ["d"], add: [] },
    ]);
    expect(hunks(base, base)).toEqual([]);
  });

  test("rejecting a hunk puts back just that stretch, and it stops being a hunk", () => {
    const { base, branch } = fork("a\nb\nc\nd\ne");
    edit(branch, [
      { kind: "insert", after: null, text: "top" },
      { kind: "set", line: "L2", base: rev(branch, "L2"), text: "B" },
      { kind: "insert", after: "L2", text: "b2" },
      { kind: "delete", line: "L3", base: rev(branch, "L3") },
      { kind: "delete", line: "L5", base: rev(branch, "L5") },
    ]);
    expect(text(branch)).toBe("top\na\nB\nb2\nd");
    const [top, mid, end] = hunks(base, branch);
    edit(branch, revertOps(branch, mid!));
    expect(text(branch)).toBe("top\na\nb\nc\nd");
    expect(hunks(base, branch).map((h) => h.key)).toEqual([top!.key, end!.key]);
    edit(branch, revertOps(branch, hunks(base, branch)[1]!));
    edit(branch, revertOps(branch, hunks(base, branch)[0]!));
    expect(text(branch)).toBe(text(base));
    expect(hunks(base, branch)).toEqual([]);
  });

  test("a file new on the branch is one hunk of added lines", () => {
    const branch = empty();
    apply(branch, fromText("x\ny"), "agent-a");
    expect(hunks(empty(), branch)).toMatchObject([{ key: "L1", at: 1, before: null, del: [], add: [{ text: "x" }, { text: "y" }] }]);
  });
});
