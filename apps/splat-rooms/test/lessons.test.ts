// The first hunt's tutorial, as the hunt feeds it: the card waits on each step in order, so picking before splatting
// doesn't skip the splats (it moves past pick mode once the card gets there), and a hunt played through walks every step.
import { expect, test } from "bun:test";
import { stepAt } from "@rustybuns/util/tutorial";
import { learn, lessons, newLearnt, type Did } from "../src/game/lessons.ts";

test("a first hunt walks the steps in order", () => {
  const l = newLearnt(), steps = lessons(l);
  const after = (...did: Did[]) => { for (const d of did) learn(l, d); return stepAt(steps, 0); };
  expect(after()).toBe(0);
  expect(after("pick", "shot", "shot")).toBe(0);
  expect(after("shot")).toBe(1);
  expect(after("spray")).toBe(steps.length - 1);
  expect(after("found")).toBe(steps.length);
});
