// Asking in words with stand-ins for Workers AI: tiles are read once, a question finds them by
// their words through the same 1-bit top-k, Clef's probabilities pick one (or none), Clairic
// pulls the answer, and the daily budget stops it all when spent. Plus the price, worked out.
import { expect, test } from "bun:test";
import { takeToday } from "@rustybuns/util/limits";
import { askInWords, readTiles, type AskDeps } from "../src/ask/ask.ts";
import type { ClairicInput, ClefInput } from "../src/ask/models.ts";
import { indexCost, questionCost } from "../src/ask/price.ts";
import { WordIndex } from "../src/ask/words.ts";

// What's printed on each tile of a few screenshots. Row 2 holds the answer; row 4 is blank.
const TILES = [
  "Home Products Pricing Docs Sign in",
  "Pricing plans compared: Free, Team, Business",
  "Team plan $12 per seat per month, billed yearly",
  "Our team: meet the people behind the product",
  "",
  "Contact sales for Enterprise pricing",
];
const ANSWER_ROW = 2;

/** Workers AI as the tests need it: Clairic reads the printed words, Clef says yes to the answer tile. */
function fakeAi(budget = Infinity) {
  const calls: string[] = [];
  let count = { day: "2026-11-04", n: 0 };
  const rowOf = (image: string) => Number(image.split("-")[1]);
  const deps: AskDeps = {
    image: async (row) => `data:image/png;base64,tile-${row}`,
    take: async () => {
      const next = takeToday(count, "2026-11-04", budget);
      count = { day: next.day, n: next.n };
      return next.ok;
    },
    run: async (input: ClefInput | ClairicInput) => {
      calls.push(input.model);
      if ("questions" in input) {
        const rows = input.images.map(rowOf), aboutSeats = /seat/i.test(input.state);
        return { model: "clef", usage: { input_tokens: 1, output_tokens: 0 }, answers: Object.fromEntries(rows.map((r) => [`t${r}`, { type: "noul", noul: aboutSeats && r === ANSWER_ROW ? 0.91 : 0.08 }])) };
      }
      const row = rowOf(input.images[0]!);
      if (input.fields.words) return { model: "clairic", truncated: false, answers: { words: { type: "text", value: TILES[row] || null } } };
      return { model: "clairic", truncated: false, answers: { answer: { type: "text", value: row === ANSWER_ROW ? "$12 per seat per month" : null, confidence: 0.88 } } };
    },
  };
  return { deps, calls };
}

test("a question in words finds the tile, Clef picks it, Clairic pulls the answer", async () => {
  const { deps, calls } = fakeAi();
  const index = new WordIndex(TILES.length);
  expect(await readTiles(TILES.map((_, i) => i), index, deps)).toEqual({ read: 6, kept: 5 });

  const a = await askInWords("How much is the Team plan per seat?", index, deps, { k: 4 });
  expect(a.tile).toBe(ANSWER_ROW);
  expect(a.answer).toBe("$12 per seat per month");
  expect(a.ranked[0]).toEqual({ row: ANSWER_ROW, p: 0.91 });
  expect(a.ranked.length).toBeLessThanOrEqual(4);
  // Six reads, one Clef call for four tiles, one Clairic pull.
  expect(calls).toEqual([...Array(6).fill("clairic"), "clef", "clairic"]);

  // Words found tiles, but Clef says none of them answers: no pull, no made-up answer.
  const none = await askInWords("What does the Business plan include?", index, deps);
  expect(none.stop).toBe("no tile answers");
  expect(none.answer).toBeUndefined();
  expect(await askInWords("zebra xylophone", index, deps)).toEqual({ ranked: [], stop: "no words match" });
});

test("the daily budget stops paid calls where it runs out", async () => {
  const { deps, calls } = fakeAi(7);
  const index = new WordIndex(TILES.length);
  await readTiles(TILES.map((_, i) => i), index, deps);
  const a = await askInWords("Team plan price per seat", index, deps, { k: 4 });
  expect(a).toMatchObject({ tile: ANSWER_ROW, stop: "daily budget spent" });
  expect(calls.length).toBe(7);
});

test("a reply that isn't Clef's shape is refused, not trusted", async () => {
  const { deps } = fakeAi();
  const index = new WordIndex(TILES.length);
  await readTiles(TILES.map((_, i) => i), index, deps);
  const broken: AskDeps = { ...deps, run: async () => ({ answers: "yes" }) };
  expect(askInWords("Team plan price per seat", index, broken)).rejects.toThrow("answers");
});

test("price per question at k = 10, and to read a corpus once", () => {
  const q = questionCost(10);
  expect(q.calls).toBe(4); // three Clef calls of up to four tiles, one Clairic pull
  expect(q.dollars).toBeLessThan(0.0005);
  // The demo's 12 pages are about 1,600 tiles: about two cents to read once.
  expect(indexCost(1600).dollars).toBeLessThan(0.03);
});
