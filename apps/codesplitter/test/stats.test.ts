import { describe, expect, test } from "bun:test";
import { apply, empty, fromText, merge } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { countMerge, readStats } from "../src/stats.ts";
import { local as boot } from "../src/local.ts";

function sides(content: string, onMain: string, onBranch: string) {
  const main = empty();
  apply(main, fromText(content), "me");
  const base = structuredClone(main), branch = structuredClone(main);
  apply(main, diffToOps(main.lines, onMain.split("\n")), "ana");
  apply(branch, diffToOps(branch.lines, onBranch.split("\n")), "bot");
  return { base, branch, main };
}

describe("solved clashes", () => {
  test("a line both sides changed, settled with no card, is counted", () => {
    const s = sides("the quick fox jumps over the lazy dog", "the quick brown fox jumps over the lazy dog", "the quick fox jumps over the lazy cat");
    const m = merge(s.base, s.branch, s.main, {}, "bot", "notes.md");
    expect(m.conflicts).toEqual([]);
    expect(m.solved).toBe(1);
  });

  test("changes in different places are no clash", () => {
    const s = sides("a\nb\nc\nd\ne\nf\ng\nh", "A\nb\nc\nd\ne\nf\ng\nh", "a\nb\nc\nd\ne\nf\ng\nH");
    expect(merge(s.base, s.branch, s.main, {}, "bot", "notes.txt").solved).toBeUndefined();
  });

  test("a clash the merger picked a side for is theirs, not the engine's", () => {
    const s = sides("one\ntwo\nthree", "one\nTWO\nthree", "one\n2\nthree");
    const first = merge(s.base, s.branch, s.main, {}, "bot", "notes.txt");
    const given = Object.fromEntries(first.conflicts.map((c) => [c.line, "branch" as const]));
    expect(merge(s.base, s.branch, s.main, given, "bot", "notes.txt").solved).toBeUndefined();
  });
});

describe("site stats", () => {
  test("counts add up and a read is served from KV for a while", async () => {
    const app = await boot({ GH_CLI: "off" });
    const env = app.env;
    const kv = new Map<string, string>();
    env.STATS = { get: async (k: string) => (kv.has(k) ? JSON.parse(kv.get(k)!) : null), put: async (k: string, v: string) => { kv.set(k, v); } };
    await countMerge(env, 2);
    await countMerge(env, 0);
    expect(await readStats(env)).toEqual({ merges: 2, solved: 2 });
    await countMerge(env, 1);
    expect(await readStats(env)).toEqual({ merges: 2, solved: 2 }); // the KV copy, not D1
    kv.clear();
    expect(await readStats(env)).toEqual({ merges: 3, solved: 3 });
    app.close();
  });
});
