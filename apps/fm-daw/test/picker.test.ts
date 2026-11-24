// The studio pickers on the jam room's menu: the desert gathering heads the list, and the row of cards is that list
// seven times, the real one, then seven more, starting on the current studio in the real copy.
import { expect, test } from "bun:test";
import { studios } from "../src/studio/door.ts";
import { COPIES, wheel } from "../src/studio/picker.ts";

test("the row starts on the current studio in the middle of fifteen copies, desert first", () => {
  const list = studios(), ids = list.map((s) => s.id), n = list.length;
  expect(ids[0]).toBe("desert-gathering");
  expect(COPIES).toBe(7);
  const { cards, start } = wheel(list, "barn");
  expect(cards).toHaveLength(15 * n);
  // each copy is the list in order, numbered -7 to 7
  for (let c = 0; c < 15; c++) {
    const copy = cards.slice(c * n, (c + 1) * n);
    expect(copy.map((x) => x.s.id)).toEqual(ids);
    expect(new Set(copy.map((x) => x.copy))).toEqual(new Set([c - 7]));
  }
  expect(cards[start]).toEqual({ s: list[ids.indexOf("barn")], copy: 0 });
  // a studio this page doesn't know: the real copy's first card
  expect(wheel(list, "nowhere").start).toBe(7 * n);
});
