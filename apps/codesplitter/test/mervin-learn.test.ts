import { describe, expect, test } from "bun:test";
import { branchWeight, demotedLevels, fightWeights, suggestions, weightOrder } from "../src/mervin-learn.ts";

const w = fightWeights([{ ext: "json", path: "package.json", fights: 6 }, { ext: "md", fights: 1 }]);

describe("fight weights", () => {
  test("a path's own count beats its extension's", () => {
    expect(branchWeight(["package.json"], w)).toBe(6);
    expect(branchWeight(["a/x.md", "b/y.md"], w)).toBe(2);
    expect(branchWeight(["x.ts"], w)).toBe(0);
  });
  test("the order only moves a fight-prone branch behind a calmer neighbour", () => {
    const files = new Map([["a", ["package.json"]], ["b", ["x.ts"]], ["c", ["y.ts"]]]);
    expect(weightOrder(["a", "b", "c"], files, w)).toEqual(["b", "a", "c"]);
    expect(weightOrder(["a", "b", "c"], files, fightWeights([]))).toEqual(["a", "b", "c"]);
  });
});

describe("self-heal", () => {
  test("a level with a bad record on the repo is demoted, a thin or clean one is not", () => {
    expect(demotedLevels([
      { level: "L2", settled: 10, wrong: 4 }, { level: "L1", settled: 50, wrong: 1 }, { level: "L3", settled: 2, wrong: 2 },
    ])).toEqual(["L2"]);
  });
  test("a repeated card answer becomes a .gitattributes line, a split one does not", () => {
    expect(suggestions([
      { path: "package.json", answer: "main", n: 4 }, { path: "CHANGELOG.md", answer: "both", n: 5 },
      { path: "src/a.ts", answer: "main", n: 3 }, { path: "src/a.ts", answer: "branch", n: 3 },
    ]).map((s) => s.rule)).toEqual(["CHANGELOG.md merge=union", "package.json merge=ours"]);
  });
});
