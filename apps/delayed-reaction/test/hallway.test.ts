import { expect, test } from "bun:test";
import { mulberry32 } from "@rustybuns/util";
import { burst, echoBursts, lanePoint, partAt, project, view } from "../src/hallway.ts";

test("further down the hallway is smaller and nearer the vanishing point", () => {
  const v = view(390, 844);
  const [nx, ny] = project(v, 2, 0, 2), [fx, fy] = project(v, 2, 0, 20);
  expect(fx).toBeLessThan(nx);
  expect(fy).toBeLessThan(ny);
  expect(Math.abs(fx - v.cx)).toBeLessThan(Math.abs(nx - v.cx));
  expect(project(v, 0, 0, 1e6)[1]).toBeCloseTo(v.hy, 0);
});

test("a hit's explosion echoes at its door once per delay, smaller each time, and then fades", () => {
  const bursts = [{ ...burst(2, 10, 1), x: 0.5 }];
  echoBursts(bursts, 10.5, 4);
  expect(bursts.length).toBe(1);
  echoBursts(bursts, 14, 4);
  expect(bursts.map((b) => b.beat)).toEqual([14]); // the first has faded; its echo is alive
  expect(bursts[0]!.size).toBeCloseTo(0.55);
  expect(bursts[0]!.x).toBe(0.5); // the echo goes off at the same door
  echoBursts(bursts, 18, 4);
  echoBursts(bursts, 22, 4);
  expect(bursts.map((b) => b.beat)).toEqual([22]);
  echoBursts(bursts, 26, 4);
  expect(bursts.length).toBe(0); // 0.55³ is under the floor: the echo died out
});

test("lanes are angles round the tunnel: left pads land left of right pads, all on the floor side", () => {
  const v = view(390, 844);
  const xs = ([0, 1, 2, 3] as const).map((lane) => lanePoint(v, lane, 4, 0));
  for (let i = 1; i < xs.length; i++) expect(xs[i]![0]).toBeGreaterThan(xs[i - 1]![0]);
  expect(xs[1]![0]).toBeLessThan(v.cx); // the two middle lanes straddle the middle
  expect(xs[2]![0]).toBeGreaterThan(v.cx);
  for (const [, y] of xs) expect(y).toBeGreaterThan(v.hy); // below the vanishing point: the floor
  const [, farY] = lanePoint(v, 0, 20, 0);
  expect(farY).toBeLessThan(xs[0]![1]); // a far ring sits higher on the screen than a near one
});

test("a burst's particles come from its rng, fly out, and slow to a drift within a beat", () => {
  const a = burst(1, 0, 1, mulberry32(7)), b = burst(1, 0, 1, mulberry32(7));
  expect(a.parts).toEqual(b.parts);
  expect(a.parts.length).toBeLessThanOrEqual(40);
  const step = (t: number) => a.parts.map((p) => {
    const [x0, y0, z0] = partAt(p, t, 1), [x1, y1, z1] = partAt(p, t + 0.05, 1);
    return Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  });
  const early = step(0), late = step(0.95);
  early.forEach((d, i) => {
    expect(d).toBeGreaterThan(0.05);
    expect(late[i]!).toBeLessThan(d * 0.8);
  });
});
