import { expect, test } from "bun:test";
import { INDEX_MAX, MATCH_ID, addToIndex, summarize } from "../src/archive.ts";
import { take } from "../src/budget.ts";
import { newMatch } from "../src/engine/match.ts";
import { PROMPTS, promptFor } from "../src/engine/prompts.ts";

test("the index puts the newest first, replaces a repeat and stays capped", () => {
  const s = (id: string) => summarize(newMatch(id, "p", [{ model: "clef", name: "Clef" }], 1, 0));
  let index = Array.from({ length: INDEX_MAX }, (_, i) => s(`m-${1_000_000_000 + i}`));
  index = addToIndex(index, s("m-2000000000"));
  expect(index.length).toBe(INDEX_MAX);
  expect(index[0]!.id).toBe("m-2000000000");
  expect(addToIndex(index, s("m-2000000000")).filter((x) => x.id === "m-2000000000").length).toBe(1);
});

test("match ids are the arena's, nothing else reaches R2", () => {
  expect(MATCH_ID.test(`m-${Date.now()}`)).toBe(true);
  for (const bad of ["../index", "m-1", "index.json", "m-1791810759744/../x"]) expect(MATCH_ID.test(bad)).toBe(false);
});

test("the budget resets each day and stops at the cap", () => {
  expect(take({ day: "2026-10-12", n: 1 }, "2026-10-12", 2)).toEqual({ day: "2026-10-12", n: 2, ok: true });
  expect(take({ day: "2026-10-12", n: 2 }, "2026-10-12", 2).ok).toBe(false);
  expect(take({ day: "2026-10-11", n: 2 }, "2026-10-12", 2)).toEqual({ day: "2026-10-12", n: 1, ok: true });
});

test("one prompt an hour, walking the list", () => {
  const hour = 3_600_000;
  expect(promptFor(0)).toBe(PROMPTS[0]!);
  expect(promptFor(hour + 59 * 60_000)).toBe(PROMPTS[1]!);
  expect(new Set(PROMPTS).size).toBe(PROMPTS.length);
});
