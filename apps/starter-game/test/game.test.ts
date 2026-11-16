// A round of the game as a player plays it: follow the stars and they score; stop and they cost lives until it's over.
import { expect, test } from "bun:test";
import { H, LIVES, newWorld, start, step } from "../src/game.ts";

test("a round: stars caught under the basket score, missed ones end it", () => {
  const w = newWorld(7);
  start(w);
  // Steer under the lowest star for 20 seconds.
  for (let i = 0; i < 20 * 60; i++) {
    const low = w.stars.reduce((a, s) => (s.y > (a?.y ?? -1) ? s : a), w.stars[0]);
    step(w, 1 / 60, low?.x ?? w.x);
  }
  expect(w.score).toBeGreaterThan(5);
  expect(w.phase).toBe("play");

  // Then park in a corner: misses take the lives and the round ends.
  for (let i = 0; i < 60 * 60 && w.phase === "play"; i++) step(w, 1 / 60, 0);
  expect(w.phase).toBe("over");
  expect(w.lives).toBeLessThanOrEqual(0);
  expect(w.stars.every((s) => s.y <= H)).toBe(true);

  start(w);
  expect([w.phase, w.score, w.lives]).toEqual(["play", 0, LIVES]);
});
