// Touch play: the left thumb's drag reads as a stick that feeds step() like WASD, and every venue has its pad of keys.
import { expect, test } from "bun:test";
import { GARAGE, newWorld, step } from "../src/sim.ts";
import { DIVE_BAR } from "../src/venues/dive-bar.ts";
import { BIGGER_BAR } from "../src/venues/bigger-bar.ts";
import { PARK } from "../src/venues/park.ts";
import { ARENA } from "../src/venues/arena.ts";
import { SMALL_ARENA } from "../src/venues/small-arena.ts";
import { SHOW } from "../src/venues/show.ts";
import { DESERT } from "../src/venues/desert.ts";
import { stick, venuePad } from "../src/touch.ts";

test.each([
  ["a thumb resting where it landed", 0, 0, 0, 0],
  ["a twitch inside the dead zone", 5, -5, 0, 0],
  ["straight up the screen, all the way", 0, -60, 0, 1],
  ["past the rim still reads full tilt", 0, 200, 0, -1],
  ["half way right", 30, 0, (0.5 - 0.15) / 0.85, 0],
])("%s", (_, dx, dy, x, y) => {
  const s = stick(dx, dy);
  expect(s.x).toBeCloseTo(x, 5);
  expect(s.y).toBeCloseTo(y, 5);
});

test("a thumb pushed up walks you forward as W does", () => {
  const thumb = newWorld(GARAGE), key = newWorld(GARAGE);
  const s = stick(0, -80);
  for (let i = 0; i < 30; i++) {
    step(thumb, 1 / 30, { forward: s.y, right: s.x, turn: 0, crouch: false });
    step(key, 1 / 30, { forward: 1, right: 0, turn: 0, crouch: false });
  }
  expect(thumb.you.z).not.toBeCloseTo(newWorld(GARAGE).you.z, 2);
  expect([thumb.you.x, thumb.you.z]).toEqual([key.you.x, key.you.z]);
});

test("every venue has a touch pad with a label on each button; the garage has none", () => {
  expect(venuePad(GARAGE.name)).toEqual([]);
  for (const level of [DIVE_BAR, BIGGER_BAR, PARK, ARENA, SMALL_ARENA, SHOW, DESERT]) {
    const pad = venuePad(level.name);
    expect(pad.length).toBeGreaterThan(0);
    expect(pad.find((b) => b.code === "Enter")).toBeDefined();
  }
});
