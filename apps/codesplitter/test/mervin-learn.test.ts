import { describe, expect, test } from "bun:test";
import { branchWeight, fightWeights, suggestions, weightOrder } from "../src/mervin-learn.ts";

const w = fightWeights([{ ext: "json", path_hash: "pj", fights: 6 }, { ext: "md", fights: 1 }]);

describe("fight weights", () => {
  test("a path's own count beats its extension's", () => {
    const key = (p: string) => p === "package.json" ? "pj" : p;
    expect(branchWeight(["package.json"], w, key)).toBe(6);
    expect(branchWeight(["a/x.md", "b/y.md"], w)).toBe(2);
    expect(branchWeight(["x.ts"], w)).toBe(0);
  });
  test("the order only moves a fight-prone branch behind a calmer neighbour", () => {
    const files = new Map([["a", ["package.json"]], ["b", ["x.ts"]], ["c", ["y.ts"]]]);
    expect(weightOrder(["a", "b", "c"], files, w, (p) => p === "package.json" ? "pj" : p)).toEqual(["b", "a", "c"]);
    expect(weightOrder(["a", "b", "c"], files, fightWeights([]))).toEqual(["a", "b", "c"]);
  });
});

describe("self-heal", () => {
  test("a repeated card answer becomes a .gitattributes line, a split one does not", () => {
    expect(suggestions([
      { path_hash: "pj", answer: "main", n: 4 }, { path_hash: "cl", answer: "both", n: 5 },
      { path_hash: "a", answer: "main", n: 3 }, { path_hash: "a", answer: "branch", n: 3 },
    ]).map((s) => [s.path_hash, s.rule])).toEqual([["cl", "merge=union"], ["pj", "merge=ours"]]);
  });
});
