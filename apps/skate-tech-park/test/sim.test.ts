// Journeys through the ride, headless: the same fixed-step sim the page draws.
import { expect, test } from "bun:test";
import { type Level, makeLevel, piece, railY } from "../src/level.ts";
import { quarterPipe } from "../src/levels/pieces.ts";
import { DT, IDLE, type Input, start, step, type State } from "../src/sim.ts";

const run = (s: State, seconds: number, input: (s: State) => Partial<Input>, level?: Level) => {
  for (let i = 0; i < seconds / DT; i++) step(s, { ...IDLE, ...input(s) }, level);
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

test("a level can point any way: a turned ramp has height there, and a diagonal rail is ground along its line", () => {
  const diag = makeLevel({
    name: "diag",
    pieces: [piece("ramp", "turned", 0, 0, Math.PI / 2, 4, 6, 0, 2)], // rises toward +x
    rails: [{ kind: "rail", a: { x: -10, z: -10 }, b: { x: 10, z: 10 }, y: 0.9 }],
    spawns: [],
    bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
  });
  expect(diag.height(-3, 0)).toBeCloseTo(0);
  expect(diag.height(3, 0)).toBeCloseTo(2);
  expect(diag.height(0, 5)).toBe(0); // beside it

  const sk = start("skate", -8, -8, Math.PI / 4, diag);
  sk.y = 1.1; sk.vx = sk.vz = 4; sk.vy = -1; sk.air = true; // dropping onto the rail from the side it runs
  step(sk, IDLE, diag);
  run(sk, 0.5, () => ({}), diag);
  expect(sk.grind).toBe(0);
  expect(sk.x).toBeCloseTo(sk.z, 1); // still on the diagonal
  expect(sk.x).toBeGreaterThan(-7);
});

const flat = (extra: Partial<Parameters<typeof makeLevel>[0]>) => makeLevel({
  name: "t", pieces: [], rails: [], spawns: [], bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 }, ...extra,
});

test("a rider can't ride through a tree, but can pass beside it", () => {
  const lv = flat({ obstacles: [{ x: 0, z: 10, r: 1, tall: 30 }] });
  const hit = run(start("car", 0, 0, 0, lv), 3, () => ({ throttle: 1 }), lv);
  expect(hit.z).toBeLessThan(9);
  expect(hit.last?.name).toBe("Hit a tree");
  const past = run(start("car", 4, 0, 0, lv), 3, () => ({ throttle: 1 }), lv);
  expect(past.z).toBeGreaterThan(20);
});

test("a skater grinds a rail down a slope and stays on the bar", () => {
  const lv = flat({ rails: [{ kind: "rail", a: { x: 0, z: 0 }, b: { x: 0, z: 10 }, y: 2, y2: 0.5 }] });
  const sk = start("skate", 0, -2, 0, lv);
  sk.air = true; sk.y = 2.1; sk.vy = -1; sk.vz = 4; sk.z = 0.2;
  step(sk, IDLE, lv);
  expect(sk.grind).toBe(0);
  for (let i = 0; i < 60; i++) {
    step(sk, IDLE, lv);
    expect(sk.y).toBeCloseTo(railY(lv.rails[0], sk.z / 10), 5);
  }
  expect(sk.y).toBeLessThan(1.8);
});

test("a steep curve carries the roadster up and off the lip, a box side is still a wall", () => {
  const ramp = flat({ pieces: [{ ...piece("ramp", "q", 0, 12, 0, 6, 8, 0, 0), height: (_: number, lz: number) => (lz > 4 || lz < -4 ? 0 : 3 * (1 - Math.sqrt(1 - ((lz + 4) / 8) ** 2))) } as never] });
  const car = start("car", 0, -2, 0, ramp);
  let maxY = 0;
  run(car, 3, (s) => { maxY = Math.max(maxY, s.y); return { throttle: 1, boost: true }; }, ramp);
  expect(maxY).toBeGreaterThan(2);
  const wall = flat({ pieces: [piece("box", "b", 0, 10, 0, 6, 4, 1, 1)] });
  const c2 = run(start("car", 0, 0, 0, wall), 3, () => ({ throttle: 1 }), wall);
  expect(c2.y).toBe(0);
  expect(c2.z).toBeLessThan(8.5);
});

test("a board rolling across a slope falls toward downhill, and a hard carve at speed costs speed", () => {
  const hill = makeLevel({
    name: "hill",
    pieces: [piece("ramp", "hillside", 0, 0, Math.PI / 2, 40, 40, 0, 8)], // rises toward +x
    rails: [], obstacles: [], spawns: [],
    bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
  });
  const flat = makeLevel({ ...hill, pieces: [] });

  const across = (level: Level) => {
    const sk = start("skate", 0, -10, 0, level);
    sk.speed = 5;
    run(sk, 1, () => ({}), level);
    return sk;
  };
  const onHill = across(hill), onFlat = across(flat);
  expect(onFlat.vx).toBeCloseTo(0, 3); // straight on flat ground stays straight
  expect(onHill.vx).toBeLessThan(-0.3); // turned toward -x, the way down
  expect(onHill.roll).not.toBe(0);

  const carve = (steer: number) => run(Object.assign(start("skate", 0, -10, 0, flat), { speed: 9 }), 1, () => ({ steer }), flat).speed;
  expect(carve(1)).toBeLessThan(carve(0));
});

// A quarter pipe vertical at the lip, rising toward +z from a flat run-in.
const pipe = quarterPipe({ x: 0, z: 0 }, { w: 6, d: 4, h: 2, deck: 3 });
const pipeLevel = flat({ pieces: pipe.pieces, rails: pipe.rails });

test("a skater pumping the transition rides higher than one rolling it", () => {
  const peak = (pump: boolean) => {
    const sk = Object.assign(start("skate", 0, -6, 0, pipeLevel), { speed: 9 });
    let max = 0;
    run(sk, 4, (s) => { max = Math.max(max, s.y); return { boost: pump }; }, pipeLevel);
    return max;
  };
  expect(peak(true)).toBeGreaterThan(peak(false) + 0.15);
});

test("a skater rides up the wall, goes up past the coping and drops back down it", () => {
  const sk = Object.assign(start("skate", 0, -6, 0, pipeLevel), { speed: 10 });
  let flew = false;
  run(sk, 5, (s) => { flew ||= s.air && s.y > 1.5; return { throttle: 1, boost: true }; }, pipeLevel);
  expect(flew).toBe(true);
  expect(sk.last?.name).not.toMatch(/Bail/);
  expect(sk.bail).toBeLessThanOrEqual(0);
});
