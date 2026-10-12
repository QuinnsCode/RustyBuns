import { afterAll, describe, expect, test } from "bun:test";
import { apply, empty, fromText, text, type Doc } from "../src/lines.ts";
import { diffToOps, merge3, rebase } from "../src/sync.ts";

/** A doc built from `start` through the real op path, so ids and revs are the app's own. */
function docFrom(start: string): Doc {
  const doc = empty();
  apply(doc, fromText(start), "owner");
  return doc;
}

describe("diffToOps", () => {
  const cases: [string, string][] = [
    ["a\nb\nc", "a\nb\nc"],
    ["a\nb\nc", "a\nX\nc"],
    ["a\nb\nc", "top\na\nb\nc"],
    ["a\nb\nc", "a\nb\nc\nend"],
    ["a\nb\nc", "a\nc"],
    ["a\nb\nc\nd", "a\nB\nc"],
    ["a\nb", "x\ny\nz\nb"],
    ["a\nb\nc\nd\ne", "a\nq\nr\nd\nf\ng"],
    ["a\nb\nc", "z\nw"],
    ["a", ""],
    ["", "new\nfile"],
    ["", ""],
  ];
  for (const [start, next] of cases) {
    test(`applying the ops turns ${JSON.stringify(start)} into ${JSON.stringify(next)}`, () => {
      const doc = docFrom(start);
      const ops = diffToOps(doc.lines, next === "" ? [] : next.split("\n"));
      const r = apply(doc, ops, "agent");
      expect(r.ok).toBe(true);
      expect(text(doc)).toBe(next);
    });
  }

  test("a changed line keeps its id, so blame still names the original author", () => {
    const doc = docFrom("a\nb\nc");
    const ops = diffToOps(doc.lines, ["a", "B", "c"]);
    expect(ops).toEqual([{ kind: "set", line: "L2", base: 2, text: "B" }]);
  });
});

describe("rebase", () => {
  test("drops ops on lines another writer has moved past, keeps the rest", () => {
    const doc = docFrom("a\nb\nc");
    const ops = diffToOps(doc.lines, ["A", "B", "c"]);
    // Someone else changes line 1 while the agent works.
    apply(doc, [{ kind: "set", line: "L1", base: 1, text: "mine" }], "human");
    const r = rebase(ops, doc);
    expect(r.skipped).toEqual([{ kind: "set", line: "L1", base: 1, text: "A" }]);
    expect(apply(doc, r.ops, "agent").ok).toBe(true);
    expect(text(doc)).toBe("mine\nB\nc");
  });

  test("drops an insert whose anchor line was deleted meanwhile", () => {
    const doc = docFrom("a\nb");
    const ops = diffToOps(doc.lines, ["a", "x", "b"]);
    apply(doc, [{ kind: "delete", line: "L1", base: 1 }], "human");
    expect(rebase(ops, doc).skipped.length).toBe(1);
  });
});

describe("diffToOps on big files", () => {
  test("a 5,000-line file with one line changed keeps every other id (25M cells used to replace it all)", () => {
    const start = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const doc = docFrom(start.join("\n"));
    const next = [...start];
    next[2500] = "changed";
    next.splice(4000, 0, "inserted");
    next.splice(100, 1);
    const t = performance.now();
    const ops = diffToOps(doc.lines, next);
    expect(performance.now() - t).toBeLessThan(500);
    expect(ops).toEqual([
      { kind: "delete", line: "L101", base: 101 },
      { kind: "set", line: "L2501", base: 2501, text: "changed" },
      { kind: "insert", after: "L4000", text: "inserted" },
    ]);
    expect(apply(doc, ops, "agent").ok).toBe(true);
    expect(text(doc)).toBe(next.join("\n"));
    expect(doc.lines.filter((l) => l.by === "owner").length).toBe(4998);
  });

  test("rewriting every line of a big file still finishes and applies", () => {
    const doc = docFrom(Array.from({ length: 3000 }, (_, i) => `old ${i}`).join("\n"));
    const next = Array.from({ length: 3000 }, (_, i) => `new ${i}`);
    const ops = diffToOps(doc.lines, next);
    expect(apply(doc, ops, "agent").ok).toBe(true);
    expect(text(doc)).toBe(next.join("\n"));
  });

  test("keeps as many lines as a full LCS on random edits", () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    const lcs = (a: string[], b: string[]) => {
      const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
      for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
        dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      return dp[0]![0]!;
    };
    for (let round = 0; round < 300; round++) {
      // A small alphabet makes lots of repeated lines, the hard case for a diff.
      const start = Array.from({ length: rand(30) }, () => "abcd"[rand(4)]!);
      const next = Array.from({ length: rand(30) }, () => "abcd"[rand(4)]!);
      const doc = docFrom(start.join("\n"));
      const ops = diffToOps(doc.lines, next);
      const r = apply(doc, ops, "agent");
      expect(r.ok).toBe(true);
      expect(doc.lines.map((l) => l.text)).toEqual(next);
      // Lines no op touched are the kept ones; there must be an LCS's worth.
      const touched = new Set(ops.flatMap((o) => (o.kind === "insert" ? [] : [o.line])));
      const kept = docFrom(start.join("\n")).lines.length - touched.size;
      expect(kept).toBe(lcs(start.length ? start : [""], next));
    }
  });
});

describe("merge3", () => {
  const base = ["a", "b", "c", "d", "e", "f"];

  test("changes on different lines both land", () => {
    const ours = ["a", "b", "c", "d", "e", "f", "g"];          // a line added at the end, live
    const theirs = ["A", "b", "c", "x", "d", "e", "f"];        // a changed, x inserted after c
    expect(merge3(base, ours, theirs)).toEqual(["A", "b", "c", "x", "d", "e", "f", "g"]);
    expect(merge3(base, ["b", "c", "d", "e", "f"], ["a", "b", "c", "d", "F"])).toEqual(["b", "c", "d", "F"]);   // ours removed a, theirs changed f
    expect(merge3(base, base, ["a", "e", "f"])).toEqual(["a", "e", "f"]);
  });

  test("a change on, or right next to, a line ours changed is a clash", () => {
    expect(merge3(base, ["a", "B", "c", "d", "e", "f"], ["a", "b2", "c", "d", "e", "f"])).toBeNull();
    expect(merge3(base, ["a", "B", "c", "d", "e", "f"], ["a", "b", "C", "d", "e", "f"])).toBeNull();
    expect(merge3(base, ["z", ...base], ["y", ...base])).toBeNull();                        // both insert at the top
    expect(merge3(base, [...base, "g"], ["a", "b", "c", "d", "e", "F"])).toBeNull();       // ours appended right after theirs' change
  });

  test("with nothing changed on either side it's ours", () => {
    expect(merge3(base, ["a", "q", "b", "c", "d", "e", "f"], base)).toEqual(["a", "q", "b", "c", "d", "e", "f"]);
    expect(merge3([], [], ["new"])).toEqual(["new"]);
  });
});
