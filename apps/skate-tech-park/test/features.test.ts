// The landscape features of the kit: each answers the height a rider would meet, and the parks that
// use them still load with them in place.
import { expect, test } from "bun:test";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { fallenLog, geyserCone, halfpipe, K, L, outcrop, rollers, tabletop } from "../src/levels/pieces.ts";
import { IDLE, start, step } from "../src/sim.ts";

const at = { x: 0, z: 0 };
// Parts are authored in person-sized metres and built K (widths, heights) and L (lengths) times bigger.
const h = (p: { pieces: { height(x: number, z: number): number }[] }, x: number, z: number) => p.pieces[0]!.height(x, z);

test("a halfpipe has a flat channel, walls rising to coping at the lip, and a mouth eased in at each end", () => {
  const p = halfpipe(at, { w: 20, d: 40, h: 3, floor: 4, deck: 1.5 });
  expect(h(p, 0, 0)).toBe(0);
  expect(h(p, 9 * K, 0)).toBeCloseTo(3 * K, 1); // the deck
  expect(h(p, 5 * K, 0)).toBeGreaterThan(0.2);
  expect(h(p, 5 * K, 0)).toBeLessThan(3 * K);
  expect(h(p, 9 * K, 19.99 * L)).toBeLessThan(0.2);
  expect(p.rails.every((r) => r.kind === "coping" && r.y === 3 * K)).toBe(true);
});

test("a tabletop rises, stays level, and drops; rollers rise and fall in rhythm", () => {
  const t = tabletop(at, { d: 26, h: 1.6, ramp: 5 });
  expect(h(t, 0, -13 * L)).toBe(0);
  expect(h(t, 0, 0)).toBeCloseTo(1.6 * K);
  expect(h(t, 0, 13 * L)).toBe(0);
  const r = rollers(at, { n: 5, period: 7, h: 0.8 }); // crests mid-way through a period, troughs at its ends
  expect(h(r, 0, (-17.5 + 10.5) * L)).toBeCloseTo(0.8 * K, 1);
  expect(h(r, 0, (-17.5 + 14) * L)).toBeCloseTo(0, 1);
});

test("a log is round with a grind along its top, a boulder a dome, and a geyser cone a rim round a crater", () => {
  const log = fallenLog(at, { len: 14, r: 0.7 });
  expect(h(log, 0, 0)).toBeCloseTo(0.7 * K);
  expect(h(log, 0.6 * K, 0)).toBeLessThan(0.5 * K);
  expect(log.rails[0]!.kind).toBe("ledge");
  const b = outcrop(at, { r: 3, h: 2 });
  expect(h(b, 0, 0)).toBeCloseTo(2 * K);
  expect(h(b, 2.9 * K, 0)).toBeLessThan(0.6 * K);
  const c = geyserCone(at, { r: 7, h: 2.2 });
  const rim = h(c, 7 * 0.35 * K, 0);
  expect(rim).toBeCloseTo(2.2 * K, 1);
  expect(h(c, 0, 0)).toBeLessThan(rim - 0.8 * K);
});

test("driving at a halfpipe wall climbs it, on the creek at Yosemite Falls", () => {
  const level = LEVELS.find((l) => l.id === "yosemite-falls")!.load() as ParkLevel;
  const pipe = level.pieces.find((p) => p.name === "creek halfpipe")!;
  const s = start(pipe.x - 7, pipe.z, Math.PI / 2, level); // in the channel, facing the +x wall
  let top = s.y;
  for (let i = 0; i < 4 * 60; i++) { step(s, { ...IDLE, throttle: 1, boost: s.speed < 22 }, level); top = Math.max(top, s.y); }
  expect(top).toBeGreaterThan(level.height(pipe.x, pipe.z) + 1);
});
