// Journeys through the ride, headless: the same fixed-step sim the page draws.
import { expect, test } from "bun:test";
import { DT, IDLE, type Input, start, step, type State } from "../src/sim.ts";

const run = (s: State, seconds: number, input: (s: State) => Partial<Input>) => {
  for (let i = 0; i < seconds / DT; i++) step(s, { ...IDLE, ...input(s) });
  return s;
};

test("the roadster's rear thrusters carry it over the gap that a board can't clear", () => {
  const car = run(start("car", 27, -38), 5, () => ({ throttle: 1, boost: true }));
  expect(car.last?.name).not.toMatch(/Spun|Bail/);
  expect(car.z).toBeGreaterThan(-2); // past the gap
  expect(car.last?.points).toBeGreaterThan(0);
  expect(car.tank).toBeLessThan(1);

  const board = run(start("skate", 27, -38), 5, () => ({ throttle: 1 }));
  expect(board.z).toBeLessThan(-2); // it rolled back off the kicker, or fell in
});

test("lift and spin thrusters hover the roadster through a 360 and set it down clean", () => {
  const car = start("car", 0, -20);
  run(car, 4, (s) => ({ jump: s.t < 0.7, steer: s.air && s.spun < 2 * Math.PI ? 1 : 0 }));
  expect(car.air).toBe(false);
  expect(car.last?.name).toBe("360");
  expect(car.tank).toBeLessThan(0.9);
});

test("an empty tank fires nothing", () => {
  const car = start("car", 0, -20);
  car.tank = 0;
  step(car, { ...IDLE, boost: true, jump: true });
  expect(car.firing).toEqual({ rear: false, lift: false, spin: 0 });
  expect(car.air).toBe(false);
});

test("a skater ollies onto the rail, grinds it, and kickflips out of the grind", () => {
  const sk = start("skate", -12, -18);
  const names: string[] = [];
  run(sk, 6, (s) => {
    if (s.last && names.at(-1) !== s.last.name) names.push(s.last.name);
    return { throttle: s.t < 1.4 ? 1 : 0, jump: s.grind < 0 ? s.z > -11.5 && s.z < -10.5 : s.z > 7, flip: s.air && s.z > 7 };
  });
  expect(names[0]).toBe("50-50 grind");
  expect(names.some((n) => n.includes("kickflip"))).toBe(true);
  expect(sk.score).toBeGreaterThan(300);
});

test("landing sideways is a bail, and the rider gets back up", () => {
  const sk = start("skate", 0, -20);
  run(sk, 2.5, (s) => ({ throttle: s.t < 1.5 ? 1 : 0, jump: s.t > 1.5 && s.t < 1.55, steer: s.air && s.spun < Math.PI / 2 ? 1 : 0 }));
  expect(sk.last?.name).toMatch(/Bail/);
  run(sk, 1.5, () => ({ throttle: 1 }));
  expect(sk.bail).toBeLessThanOrEqual(0);
  expect(sk.speed).toBeGreaterThan(0);
});
