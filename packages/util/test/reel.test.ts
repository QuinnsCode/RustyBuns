import { expect, test } from "bun:test";
import { crane, dollyZoom, orbit, reel, still, truck, vista } from "../src/index.ts";

const you = { x: 0, y: 2, z: 0 }, hills = { x: 0, y: 80, z: -900 };

test("takes play back to back, joined by a whip, a dip and a flash, then the view goes back", () => {
  const a = still({ from: { x: 0, y: 2, z: 10 }, at: you, fov: 30 }), b = still({ from: { x: 10, y: 2, z: 0 }, at: you, fov: 60 });
  const r = reel([{ seconds: 2, shot: a }, { seconds: 2, shot: b, into: { whip: 1 } }, { seconds: 2, shot: a, into: { dip: 1 }, slow: 0.3 }, { seconds: 2, shot: b, into: { flash: 0.5 }, speed: 1 }], { handBack: 1 });
  expect(r.seconds).toBe(8);
  // Halfway through the whip: halfway between the cameras, blurred, the lens between them.
  const w = r.at(2.5);
  expect([w.take, w.from.x, w.from.z, w.fov, w.whip]).toEqual([1, 5, 5, 45, 1]);
  // The dip is darkest on the join and gone half a second either side; the take after it runs slow.
  expect([r.at(3.6).dip > 0, r.at(4).dip, r.at(4.5).dip, r.at(4.2).slow]).toEqual([true, 1, 0, 0.3]);
  expect([r.at(6).flash, r.at(6.5).speed]).toEqual([1, 1]);
  expect([r.at(0).mix, r.at(6.9).mix, r.at(8).mix, r.at(99).take]).toEqual([1, 1, 0, 3]);
});

test("the parallax shot slides across the line to the hills, level; the orbit goes all the way round", () => {
  const t = truck(you, hills, { travel: 10 }), s = t(0), e = t(1);
  expect(Math.abs(e.from.x - s.from.x)).toBeCloseTo(10);
  expect(e.from.z).toBeCloseTo(s.from.z);
  expect(s.from.z).toBeGreaterThan(you.z); // behind you, the hills ahead
  const o = orbit(you, { radius: 5 });
  expect(o(0).from.x).toBeCloseTo(o(1).from.x);
  expect(o(0.5).from.z).toBeCloseTo(-5);
});

test("the crane rises and lifts its look to the hills; the dolly zoom keeps its subject the same size", () => {
  const c = crane(you, hills);
  expect(c(1).from.y).toBeGreaterThan(c(0).from.y + 3);
  expect(c(1).at.z).toBeLessThan(c(1).from.z - 10);
  const d = dollyZoom(you, { near: 4, far: 16, lens: 50 });
  const size = (u: number) => { const k = d(u), dist = Math.hypot(k.from.x - you.x, k.from.z - you.z); return dist * Math.tan((k.fov! * Math.PI) / 360); };
  expect(size(1)).toBeCloseTo(size(0));
  expect(d(1).fov!).toBeLessThan(20);
});

test("the vista is the way the ground rises highest in your eye", () => {
  // A ridge to the east, flat everywhere else.
  const v = vista((x) => (x > 300 ? 200 : 0), you);
  expect(v.x).toBeGreaterThan(300);
  expect(v.y).toBe(200);
});
