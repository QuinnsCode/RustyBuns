import { expect, test } from "bun:test";
import { APPS } from "../src/apps.ts";
import { cardIds, cardOf } from "../src/cards.ts";

test("every app has its card copy, the names agree, and cards.json names no app that isn't listed", () => {
  for (const app of APPS) {
    const card = cardOf(app.id);
    expect(card.name).toBe(app.name);
    expect(card.blurb.length).toBeGreaterThan(0);
  }
  expect(cardIds().filter((id) => !APPS.some((a) => a.id === id))).toEqual([]);
});
