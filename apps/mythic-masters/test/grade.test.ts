import { expect, test } from "bun:test";
import { gradeOf } from "../src/arena.ts";
import { ALL_SKINS } from "../src/regions.ts";

test("every arena skin's grade only leans the colour: never darkens, never blows out", () => {
  for (const [id, skin] of Object.entries(ALL_SKINS)) {
    const { tint, saturation } = gradeOf(skin);
    expect(Math.max(tint.r, tint.g, tint.b), id).toBeCloseTo(1, 5);
    expect(Math.min(tint.r, tint.g, tint.b), id).toBeGreaterThan(0.7);
    expect(saturation, id).toBeGreaterThanOrEqual(1);
    expect(saturation, id).toBeLessThan(1.2);
  }
});

test("the volcano leans warm, the sky island cool", () => {
  expect(gradeOf(ALL_SKINS.volcano!).tint.r).toBeGreaterThan(gradeOf(ALL_SKINS.volcano!).tint.b);
  expect(gradeOf(ALL_SKINS.sky!).tint.b).toBeGreaterThan(gradeOf(ALL_SKINS.sky!).tint.r);
});
