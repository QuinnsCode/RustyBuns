import { expect, test } from "bun:test";
import { APPS, GENRES, genreOf } from "../src/apps.ts";

test("every app sits in Games, Productivity or Business, codeSplitter is the one hero, and an old genre maps onto its row", () => {
  expect(APPS.filter((a) => !GENRES.includes(a.genre))).toEqual([]);
  expect(APPS.filter((a) => a.hero).map((a) => a.id)).toEqual(["codesplitter"]);
  expect(["Sports & Skate", "Work & Tools", "Games", "Nope", 3].map(genreOf)).toEqual(["Games", "Productivity", "Games", null, null]);
});
