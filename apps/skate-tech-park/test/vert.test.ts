// Vert, the way a rider reads it: a board thrown off a wall comes back down onto it.
import { expect, test } from "bun:test";
import { makeLevel } from "../src/level.ts";
import { halfpipe } from "../src/levels/pieces.ts";
import { DT, IDLE, start, step } from "../src/sim.ts";

const flat = (pieces: ReturnType<typeof halfpipe>["pieces"]) =>
  makeLevel({ name: "t", pieces, rails: [], spawns: [], bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 } });

test("off a halfpipe's vert wall the board drops back in, not out onto the flat", () => {
  const level = flat(halfpipe({ x: 0, z: 0 }, { w: 20, d: 40, h: 3 }).pieces);
  for (const speed of [18, 24]) {
    const s = Object.assign(start(0, 0, Math.PI / 2, level), { speed });
    let reentered = false, left = false, far = 0;
    for (let i = 0; i < 10 / DT; i++) {
      step(s, IDLE, level);
      far = Math.max(far, Math.abs(s.x));
      if (s.air && Math.abs(s.x) > 15) left = true;
      if (left && !s.air && Math.abs(s.x) < 17) reentered = true;
    }
    expect(left).toBe(true);
    expect(reentered).toBe(true);
    expect(far).toBeLessThan(18); // never flew out onto the deck
  }
});

test("in a halfpipe, holding push pumps a couple of vert airs that land back on the face before it rolls out, and an ollie up the wall stays in the pipe", () => {
  const hp = halfpipe({ x: 0, z: 0 }, { w: 20, d: 40, h: 3 });
  const level = flat(hp.pieces), lip = Math.max(...hp.rails.map((r) => r.y)), coping = Math.abs(hp.rails[0]!.a.x);
  for (const ride of ["push", "ollie"] as const) {
    const s = Object.assign(start(0, 0, Math.PI / 2, level), { speed: 18 });
    let airs = 0, wasAir = false, far = 0, peak = 0;
    for (let i = 0; i < 15 / DT; i++) {
      const outward = Math.sign(s.x) === Math.sign(s.vx) && s.y > lip * 0.7; // climbing, high on the wall
      step(s, { ...IDLE, throttle: 1, jump: ride === "ollie" && !s.air && outward }, level);
      far = Math.max(far, Math.abs(s.x));
      if (s.air) peak = Math.max(peak, s.y - lip);
      if (wasAir && !s.air && Math.abs(s.x) > coping - 3) airs++;
      wasAir = s.air;
      expect(s.bail).toBeLessThanOrEqual(0);
    }
    if (ride === "push") { // legs give back a share each wall: vert airs it lands back on the face
      expect(airs).toBeGreaterThanOrEqual(2);
      expect(peak).toBeGreaterThan(1.5);
    } else expect(far).toBeLessThan(coping + 0.5); // an ollie up the wall never takes it out onto the deck
  }
});

test("legs pump with one stroke per curve: a mini ramp of real proportions goes from half height to the coping in about three walls, and a held push in a vert ramp settles at a steady air", () => {
  const board = 4.4; // metres, the board's length: the ramps are sized by it, as a real ramp is by a real board
  const peaks = (radius: number, from: number, walls: number, legs: (s: ReturnType<typeof start>, h: number) => boolean) => {
    const R = radius * board, level = flat(halfpipe({ x: 0, z: 0 }, { w: R + 7, d: 40, h: R / 2 }).pieces); // round: the wall as tall as its transition
    const s = Object.assign(start(0, 0, Math.PI / 2, level), { speed: Math.sqrt(2 * 20 * from * R) }), out: number[] = [];
    let side = 0, peak = 0;
    for (let i = 0; i < 90 / DT && out.length < walls; i++) {
      step(s, { ...IDLE, throttle: legs(s, R) ? 1 : 0 }, level);
      expect(s.bail).toBeLessThanOrEqual(0);
      const w = Math.abs(s.x) > 5 ? Math.sign(s.x) : 0;
      if (w && w !== side) { if (side) out.push(peak / R); side = w; peak = 0; }
      if (w) peak = Math.max(peak, s.y);
    }
    return out;
  };
  const mini = peaks(3, 0.5, 4, (s, h) => Math.abs(s.x) > 4 && s.y < 0.85 * h); // a 2.4 m transition under a 0.8 m board, pumped on the walls only
  expect(mini[0]!).toBeGreaterThan(0.55);
  expect(mini[0]!).toBeLessThan(0.75); // one stroke is a share of its energy, not a rocket
  expect(mini[3]!).toBeGreaterThanOrEqual(1);
  const vert = peaks(4.25, 1.5, 10, () => true); // a 3.4 m vert ramp, dropped in from well over the coping
  expect(vert[9]!).toBeGreaterThan(1.1); // the pump holds an air where the legs can still press against the curve
  expect(vert[9]!).toBeLessThan(1.5);
  expect(Math.abs(vert[9]! - vert[8]!)).toBeLessThan(0.01);
});
