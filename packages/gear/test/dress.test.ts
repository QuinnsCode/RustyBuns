// Dressing a cable the way a player traces it: a shaky finger from the board to the amp rack, laid square, beside the
// one already there, against the wall, with the slack in a loop; and the meter that scores the floor.
import { expect, test } from "bun:test";
import { dress, neatness, routeOf, type DressOpts, type FloorPt } from "../src/index.ts";

const mic: DressOpts = { snap: "square", bend: 0.05, thick: 0.007 };
const board = { x: 0, z: 3 }, rack = { x: 5, z: -3 };
/** A shaky finger: across toward the wall first, then up it to the rack, wobbling a few centimetres. */
const shaky: FloorPt[] = [];
for (let i = 0; i <= 20; i++) shaky.push({ x: (5 * i) / 20, z: 3 + Math.sin(i * 1.3) * 0.04 });
for (let i = 1; i <= 24; i++) shaky.push({ x: 5 + Math.sin(i * 0.9) * 0.04, z: 3 - (6 * i) / 24 });
const n = (m: number) => Math.ceil(m / 0.2) + 1;
const gap = (p: FloorPt, q: FloorPt) => Math.hypot(p.x - q.x, p.z - q.z);

test("a shaky trace lies square, jack to jack, turned the way the finger went", () => {
  const route = routeOf(board, rack, shaky, mic);
  expect(route).toEqual([board, { x: 5, z: 3 }, rack]);
  // Traced from the rack end, it lies the same way round.
  expect(routeOf(board, rack, [...shaky].reverse(), mic)).toEqual(route);
  const d = dress(board, rack, shaky, 15, n(15), mic);
  if ("shortM" in d) throw new Error("short");
  expect(d.pts).toHaveLength(n(15));
  expect(gap(d.pts[0]!, board)).toBeLessThan(1e-9);
  expect(gap(d.pts.at(-1)!, rack)).toBeLessThan(1e-6);
  // 11 m of route, 4 m of slack: whole turns of a loop, stacked, and the meter calls the floor neat.
  expect(d.slackM).toBeCloseTo(4, 1);
  expect(Math.max(...d.pts.map((p) => p.lift))).toBeGreaterThan(0);
  expect(neatness([d.route]).score).toBe(100);
});

test("a cable too short for the path says by how much", () => {
  expect(dress(board, rack, shaky, 10, n(10), mic)).toEqual({ shortM: expect.closeTo(1, 1) });
});

test("a second run down the same path lies beside the first, and a run near a wall lies against it", () => {
  // A U from the board to the rack's other input: across, along z = 3, and back. The middle run is the one that moves.
  const u = [{ x: 0, z: 3.5 }, { x: 4.8, z: 3.5 }];
  const one = routeOf({ x: 0, z: 0 }, { x: 5, z: 0 }, u, mic);
  const two = routeOf({ x: 0.1, z: 0 }, { x: 4.9, z: 0 }, u, { ...mic, beside: [one] });
  expect(Math.abs(two[1]!.z - one[1]!.z)).toBeCloseTo(0.007, 6);
  const wall = { a: { x: -10, z: 3.7 }, b: { x: 10, z: 3.7 } };
  const hugged = routeOf({ x: 0, z: 0 }, { x: 5, z: 0 }, u, { ...mic, edges: [wall] });
  expect(hugged[1]!.z).toBeCloseTo(3.7 - 0.007, 6);
});

test("the meter: loose spaghetti scores low, square runs high, every crossing costs", () => {
  const loose = Array.from({ length: 40 }, (_, i) => ({ x: i * 0.2, z: Math.sin(i * 0.7) * 0.5 }));
  const across = [{ x: 0, z: 0 }, { x: 4, z: 0 }], down = [{ x: 2, z: -2 }, { x: 2, z: 2 }];
  expect(neatness([loose]).score).toBeLessThan(30);
  expect(neatness([across, down])).toEqual({ square: 1, crossings: 1, score: 92 });
  // 45s only count when the room is dressed in 45s.
  const diag = [{ x: 0, z: 0 }, { x: 2, z: 2 }];
  expect(neatness([diag]).score).toBe(0);
  expect(neatness([diag], true).score).toBe(100);
});
