import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
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

test("an app that says it has a screenshot has the picture, and the card-shots script knows how to shoot it again", async () => {
  const { APPS: SHOTS } = await import("../../../scripts/card-shots.ts");
  const withShot = APPS.filter((a) => a.shot).map((a) => a.id);
  expect(withShot.filter((id) => !existsSync(`${import.meta.dir}/../public/cards/${id}.jpg`))).toEqual([]);
  expect(withShot.filter((id) => !(id in SHOTS))).toEqual([]);
});
