// Journeys for the tricks: gestures into flicks, grinds by approach angle with balance, bails and the
// combo chain, and the roadster's suction fan. All headless, through the same step() the page runs.
import { expect, test } from "bun:test";
import { Gestures, resolve } from "../src/gesture.ts";
import { type Level, makeLevel, piece, type RailKind } from "../src/level.ts";
import { DT, IDLE, type Input, start, step, type State } from "../src/sim.ts";

const run = (s: State, seconds: number, input: (s: State) => Partial<Input>, level?: Level) => {
  for (let i = 0; i < seconds / DT; i++) step(s, { ...IDLE, ...input(s) }, level);
  return s;
};
const flat = (extra: Partial<Parameters<typeof makeLevel>[0]> = {}) => makeLevel({
  name: "t", pieces: [], rails: [], spawns: [], bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 }, ...extra,
});

test("a mouse drag up ollies, then a drag across in the air flicks a heelflip that lands", () => {
  const g = new Gestures();
  const sk = Object.assign(start("skate", 0, 0), { speed: 6 });
  g.down(100, 300); g.up(100, 200); // up
  let flicked = false;
  for (let i = 0; i < 150; i++) {
    if (sk.air && !flicked && sk.airTime > 0.1) { g.down(100, 100); g.up(20, 110); flicked = true; } // left
    step(sk, { ...IDLE, ...g.take() });
  }
  expect(flicked).toBe(true);
  expect(sk.last?.name).toBe("heelflip");
});

test("the right stick fires once as it leaves the dead zone, and a short drag does nothing", () => {
  const g = new Gestures();
  g.stick(0, 0.3);
  expect(g.take()).toEqual({});
  g.stick(0, 1); g.stick(0, 1); // pulled down, held
  expect(g.take()).toEqual({ flick: "shove-it" });
  expect(g.take()).toEqual({});
  expect(resolve(5, -8)).toEqual({});
});

const rail = (kind: RailKind) => flat({ rails: [{ kind, a: { x: 0, z: 0 }, b: { x: 0, z: 60 }, y: 0.9 }] });

// Drops onto the bar at `yaw` and keeps its balance with the stick; jumps off after `secs`.
const grindFrom = (yaw: number, kind: RailKind = "rail", secs = 0.6) => {
  const lv = rail(kind);
  const sk = start("skate", -Math.sin(yaw) * 0.2, 2, yaw, lv);
  sk.air = true; sk.y = 1.0; sk.vy = -1; sk.vx = Math.sin(yaw) * 4; sk.vz = Math.cos(yaw) * 4;
  run(sk, secs, (s) => ({ steer: Math.max(-1, Math.min(1, s.balance * 2)) }), lv);
  expect(sk.grind).toBe(0);
  step(sk, { ...IDLE, jump: true }, lv);
  return sk;
};

test("the angle you come at a rail decides the grind", () => {
  expect(grindFrom(0).last?.name).toBe("50-50 grind");
  expect(grindFrom(Math.PI / 2).last?.name).toBe("Boardslide");
  expect(grindFrom(0.7).last?.name).toBe("Nosegrind");
  expect(grindFrom(-0.7).last?.name).toBe("5-0 grind");
});

test("a grind left alone loses its balance and bails, and steering holds it", () => {
  const lv = rail("rail");
  const drop = () => {
    const sk = start("skate", 0, 2, 0, lv);
    sk.air = true; sk.y = 1.0; sk.vy = -1; sk.vz = 6;
    return sk;
  };
  const alone = run(drop(), 3, () => ({}), lv);
  expect(alone.last?.name).toMatch(/Bail: fell off/);
  expect(alone.grind).toBe(-1);
  expect(alone.y).toBe(0);

  const steered = run(drop(), 3, (s) => ({ steer: Math.max(-1, Math.min(1, s.balance * 2)) }), lv);
  expect(steered.grind).toBe(0);
  expect(Math.abs(steered.balance)).toBeLessThan(0.5);
});

test("a ledge slides: gentler on speed and balance, and named for it", () => {
  const onLedge = grindFrom(0, "ledge");
  expect(onLedge.last?.name).toBe("50-50 slide");
  const speedAfter = (kind: RailKind) => {
    const lv = rail(kind);
    const sk = start("skate", 0, 2, 0, lv);
    sk.air = true; sk.y = 1.0; sk.vy = -1; sk.vz = 6;
    return run(sk, 1.5, (s) => ({ steer: Math.max(-1, Math.min(1, s.balance * 2)) }), lv).speed;
  };
  expect(speedAfter("ledge")).toBeGreaterThan(speedAfter("rail"));
});

test("tricks landed in a row multiply, and a bail ends the chain", () => {
  const sk = Object.assign(start("skate", 0, 0), { speed: 5 });
  const points: number[] = [];
  let seen: State["last"] = null;
  run(sk, 4, (s) => {
    if (s.last !== seen && s.last?.points) { seen = s.last; points.push(s.last.points); }
    return { jump: !s.air, flick: s.air && s.flipT <= 0 && s.tricks.length === 0 ? "kickflip" : null };
  });
  expect(points.length).toBeGreaterThanOrEqual(3);
  expect(sk.chain).toBeGreaterThanOrEqual(3);
  expect(points[1]).toBeGreaterThan(points[0] * 1.5); // the second ride the same air for double
  expect(sk.last?.name).toMatch(/x\d/);

  // land on your side: the chain is gone and the rider gets back up
  for (let i = 0; i < 180 && sk.bail <= 0; i++) step(sk, { ...IDLE, jump: !sk.air, steer: sk.air && sk.spun < Math.PI / 2 ? 1 : 0 });
  expect(sk.bail).toBeGreaterThan(0);
  expect(sk.chain).toBe(0);
  run(sk, 2, () => ({ throttle: 1 }));
  expect(sk.bail).toBeLessThanOrEqual(0);
  expect(sk.speed).toBeGreaterThan(0);
});

test("the chain times out after a few seconds of just rolling", () => {
  const sk = Object.assign(start("skate", 0, 0), { speed: 5 });
  run(sk, 1.5, (s) => ({ jump: !s.air && s.t < 0.1 }));
  expect(sk.chain).toBe(1);
  run(sk, 5, () => ({}));
  expect(sk.chain).toBe(0);
});

test("the suction fan holds the roadster to a lip it would otherwise fly off, and drives it up a box side", () => {
  const kicker = flat({ pieces: [piece("ramp", "kicker", 0, 10, 0, 6, 6, 0, 2)] });
  const drive = (fan: boolean) => {
    const car = start("car", 0, -2, 0, kicker);
    let airborne = false;
    run(car, 2.5, (s) => { airborne ||= s.air; return { throttle: 1, fan }; }, kicker);
    return { car, airborne };
  };
  expect(drive(false).airborne).toBe(true);
  const held = drive(true);
  expect(held.airborne).toBe(false);
  expect(held.car.tank).toBeLessThan(1);

  const box = flat({ pieces: [piece("box", "b", 0, 10, 0, 6, 4, 1.2, 1.2)] });
  const without = run(start("car", 0, 0, 0, box), 3, () => ({ throttle: 1 }), box);
  expect(without.z).toBeLessThan(8.5);
  let top = 0;
  run(start("car", 0, 0, 0, box), 3, (s) => { top = Math.max(top, s.y); return { throttle: 1, fan: true }; }, box);
  expect(top).toBeCloseTo(1.2, 1);
});
