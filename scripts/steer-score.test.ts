import { expect, test } from "bun:test";
import { appOf, bm25, bm25Index, coChange, rankFiles } from "./steer-score.ts";

const past = [
  "Mythic Masters: the duel camera shakes on heavy hits",
  "Skate Tech Park: grinds on the sky rail",
  "Office: hire guard nudges a thin task once",
  "Skate Tech Park: rail grinds lean into the turn, grinds hold",
];
const ix = bm25Index(past);
const commits = [
  ["apps/skate/src/rail.ts", "apps/skate/src/grind.ts"],
  ["apps/skate/src/rail.ts", "apps/skate/src/grind.ts", "apps/skate/test/grind.test.ts"],
  ["apps/skate/src/rail.ts", "apps/skate/src/sky.ts"],
  ["apps/office/hire.ts", "bun.lock", "apps/office/docs/shot.png"],
  Array.from({ length: 40 }, (_, i) => `sweep/${i}.ts`).concat("apps/skate/src/rail.ts"),
];
const g = coChange(commits);

test.each<[string, () => unknown, unknown]>([
  ["the nearest task shares the rare words", () => bm25(ix, "duel camera")[0]?.doc, 0],
  ["more of the query's words ranks higher", () => bm25(ix, "skate grinds lean").map((h) => h.doc), [3, 1]],
  ["a task sharing no word is left out", () => bm25(ix, "blender queue"), []],
  ["a plural matches its singular", () => bm25(ix, "grind")[0]?.doc, 3],
  ["a named file comes first, then its most frequent partner", () => rankFiles(["apps/skate/src/rail.ts"], [], g).slice(0, 2), ["apps/skate/src/rail.ts", "apps/skate/src/grind.ts"]],
  ["a sweep commit pairs nothing", () => rankFiles(["sweep/1.ts"], [], g), ["sweep/1.ts"]],
  ["near tasks' files rank by weight, locks and pictures dropped", () => rankFiles([], [{ files: ["apps/office/hire.ts", "bun.lock", "apps/office/docs/shot.png"], weight: 1 }, { files: ["apps/skate/src/sky.ts"], weight: 3 }], g),
    ["apps/skate/src/sky.ts", "apps/skate/src/rail.ts", "apps/office/hire.ts"]],
  ["files that no longer exist are dropped", () => rankFiles(["apps/skate/src/rail.ts"], [], g, (f) => !f.includes("grind")), ["apps/skate/src/rail.ts", "apps/skate/src/sky.ts"]],
  ["a change's area is where most of its files sit", () => appOf(["apps/skate/a.ts", "apps/skate/b.ts", "packages/util/src/x.ts", "bun.lock"]), "skate"],
])("%s", (_, run, want) => {
  expect(run()).toEqual(want);
});
