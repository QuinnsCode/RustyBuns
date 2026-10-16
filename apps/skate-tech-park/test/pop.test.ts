// The ollie's pop: the back foot snaps the tail, the nose kicks up, the front foot drags it level, and
// the board comes down flat on its own. A flip that is nearly round when it lands is caught, not a bail.
import { expect, test } from "bun:test";
import { makeLevel } from "../src/level.ts";
import { DT, FLICK_TIME, type Foot, IDLE, noseUp, POP, start, step } from "../src/sim.ts";

const flat = makeLevel({ name: "t", pieces: [], rails: [], spawns: [], bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 300 } });

test("an ollie snaps the tail, kicks the nose up, levels itself and lands clean", () => {
  const sk = start(0, -60, 0, flat);
  for (let i = 0; i < 60; i++) step(sk, { ...IDLE, throttle: 1 }, flat);
  const feet: { foot: Foot; t: number }[] = [];
  let peak = 0, levelAt = -1;
  step(sk, { ...IDLE, jump: true }, flat);
  feet.push(...sk.feet.map((foot) => ({ foot, t: 0 })));
  for (let i = 1; sk.air && i < 300; i++) {
    step(sk, IDLE, flat);
    feet.push(...sk.feet.map((foot) => ({ foot, t: i * DT })));
    peak = Math.max(peak, noseUp(sk));
    if (levelAt < 0 && peak > 0 && noseUp(sk) === 0) levelAt = sk.airTime;
  }
  expect(feet.map((f) => `${f.foot.foot} ${f.foot.at}`)).toEqual(["back tail", "front nose"]);
  expect(feet[1]!.t).toBeCloseTo(POP.snap, 1); // the front foot drags once the tail has snapped
  expect(peak).toBeGreaterThan(POP.angle * 0.8);
  expect(levelAt).toBeGreaterThan(0);
  expect(sk.air).toBe(false);
  expect(levelAt).toBeLessThan(sk.airTime); // level before it touches down
  expect(sk.last?.name).toBe("Air");
  expect(noseUp(sk)).toBe(0);
});

test("a flip flicked late is caught flat if it is nearly round, and still a bail if it is half way", () => {
  const land = (left: number) => {
    const sk = start(0, -60, 0, flat);
    sk.speed = 8;
    step(sk, { ...IDLE, jump: true }, flat);
    // falling under gravity 20, flick when the ground is FLICK_TIME * (1 - left) away
    const toGround = () => (sk.vy + Math.sqrt(sk.vy ** 2 + 40 * (sk.y - flat.height(sk.x, sk.z)))) / 20;
    while (sk.air && toGround() > FLICK_TIME * (1 - left)) step(sk, IDLE, flat);
    step(sk, { ...IDLE, flip: true }, flat);
    while (sk.air) step(sk, IDLE, flat);
    return sk.last?.name ?? "";
  };
  expect(land(0.15)).toBe("kickflip");
  expect(land(0.5)).toMatch(/Bail: still flipping/);
});
