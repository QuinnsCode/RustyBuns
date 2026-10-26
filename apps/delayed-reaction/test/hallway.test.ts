import { expect, test } from "bun:test";
import { burst, echoBursts, project, view } from "../src/hallway.ts";

test("further down the hallway is smaller and nearer the vanishing point", () => {
  const v = view(390, 844);
  const [nx, ny] = project(v, 2, 0, 2), [fx, fy] = project(v, 2, 0, 20);
  expect(fx).toBeLessThan(nx);
  expect(fy).toBeLessThan(ny);
  expect(Math.abs(fx - v.cx)).toBeLessThan(Math.abs(nx - v.cx));
  expect(project(v, 0, 0, 1e6)[1]).toBeCloseTo(v.hy, 0);
});

test("a hit's explosion echoes once per delay, smaller each time, and then fades", () => {
  const bursts = [burst(2, 10, 1)];
  echoBursts(bursts, 10.5, 4);
  expect(bursts.length).toBe(1);
  echoBursts(bursts, 14, 4);
  expect(bursts.map((b) => b.beat)).toEqual([14]); // the first has faded; its echo is alive
  expect(bursts[0]!.size).toBeCloseTo(0.55);
  echoBursts(bursts, 18, 4);
  echoBursts(bursts, 22, 4);
  expect(bursts.map((b) => b.beat)).toEqual([22]);
  echoBursts(bursts, 26, 4);
  expect(bursts.length).toBe(0); // 0.55³ is under the floor: the echo died out
});
