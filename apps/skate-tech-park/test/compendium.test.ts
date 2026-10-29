// The trick compendium, the extra grinds and the new earth and rock, through the same sim the page runs.
import { expect, test } from "bun:test";
import { Gestures, resolve } from "../src/gesture.ts";
import { type Level, makeLevel } from "../src/level.ts";
import { DT, grindKind, IDLE, start, step } from "../src/sim.ts";
import { type Flick, TRICKS } from "../src/tricks.ts";
import { keyhole, kidney, terraced } from "../src/levels/earthworks.ts";
import { railY } from "../src/level.ts";
import { rockRidge, rockSlab } from "../src/levels/pieces.ts";

const flat = (extra: Partial<Parameters<typeof makeLevel>[0]> = {}): Level => makeLevel({
  name: "t", pieces: [], rails: [], spawns: [], bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 }, ...extra,
});

// SkateBench's naming grid (T3-Content/skatebench, MIT): board turn, flip direction, and the common name.
const BENCH: [number, number, string][] = [
  [360, 1, "tre flip"], [-360, -1, "laser flip"], [-180, 1, "hardflip"], [180, 1, "varial"], [-180, -1, "varial heel"], [180, -1, "inward heel"],
  [-180, 0, "frontside shove-it"], [360, 0, "360 shove-it"], [0, 2, "double kickflip"], [0, -2, "double heelflip"],
];
test("every trick SkateBench names is in the compendium under the same name", () => {
  for (const [board, flip, name] of BENCH) expect(TRICKS[name as Flick]).toMatchObject({ board, flip });
});

const landTrick = (flick: Flick, spin = 0) => {
  const sk = Object.assign(start(0, 0), { speed: 6 });
  step(sk, { ...IDLE, jump: true });
  let flicked = false;
  for (let i = 0; i < 400 && !(flicked && !sk.air); i++) {
    if (sk.air && !flicked && sk.airTime > 0.1) flicked = true;
    step(sk, { ...IDLE, flick: flicked && !sk.flipT && !sk.tricks.length ? flick : null, steer: spin });
  }
  return sk;
};

test("a tre flip takes longer than a kickflip, lands by its name and scores more", () => {
  const tre = landTrick("tre flip"), kick = landTrick("kickflip");
  expect(tre.last?.name).toBe("tre flip");
  expect(kick.last?.name).toBe("kickflip");
  expect(tre.last!.points).toBeGreaterThan(kick.last!.points);
});

test("a tre flip with the rider turning a half too is a big flip, a 360 shove-it under one a bigspin", () => {
  for (const [flick, name] of [["tre flip", "big flip"], ["360 shove-it", "bigspin"]] as const) {
    const sk = Object.assign(start(0, 0), { speed: 6 });
    step(sk, { ...IDLE, jump: true });
    let flicked = false;
    for (let i = 0; i < 400 && !(flicked && !sk.air); i++) {
      if (!flicked && sk.airTime > 0.1) flicked = true;
      step(sk, { ...IDLE, flick: flicked && !sk.flipT && !sk.tricks.length ? flick : null });
      if (sk.air && Math.abs(sk.spun) < Math.PI) sk.spun += 0.05; // the rider turns a half
    }
    expect(sk.last?.name).toBe(name);
  }
});

test("a grab is the manual keys held in the air: it names the air and pays by the second, and a flick lets go first", () => {
  const air = (held: (s: ReturnType<typeof start>) => -1 | 0 | 1, flickAt = Infinity) => {
    const sk = Object.assign(start(0, 0), { speed: 6 });
    step(sk, { ...IDLE, jump: true });
    for (let i = 0; i < 400 && sk.air; i++) step(sk, { ...IDLE, manual: held(sk), flick: sk.airTime > flickAt && !sk.tricks.length && !sk.flipT ? "kickflip" : null });
    return sk;
  };
  const tail = air(() => 1), nose = air((s) => (s.airTime > 0.3 ? -1 : 0)), plain = air(() => 0);
  expect(tail.last?.name).toBe("tail grab");
  expect(nose.last?.name).toBe("nose grab");
  expect(tail.last!.points).toBeGreaterThan(nose.last!.points); // held longer
  expect(nose.last!.points).toBeGreaterThan(plain.last!.points);
  expect(tail.grab).toBe(0); // the hand is off the board on the ground
  step(tail, { ...IDLE, manual: 1 }); expect([tail.manual, tail.bail]).toEqual([1, 0]); // kept held, the landing is a manual
  const flicked = air((s) => (s.airTime < 0.4 ? 1 : 0), 0.5);
  expect(flicked.last?.name).toBe("kickflip tail grab");
  const tapped = air((s) => (s.airTime > 0.3 && s.airTime < 0.4 ? 1 : 0)); // a touch of the hand, not a grab
  expect(tapped.last?.name).toBe("Air");
});

test("a long drag doubles the flick or the turn", () => {
  expect(resolve(130, 0)).toEqual({ flick: "double kickflip" });
  expect(resolve(-130, 0)).toEqual({ flick: "double heelflip" });
  expect(resolve(0, 130)).toEqual({ flick: "360 shove-it" });
  expect(resolve(60, 0)).toEqual({ flick: "kickflip" });
  expect(resolve(0, 60, undefined, "tail")).toEqual({ flick: "frontside shove-it" });
});

test("drags and stick pushes on the diagonals are the compound tricks", () => {
  expect(resolve(60, 60)).toEqual({ flick: "hardflip" });
  expect(resolve(-60, 60)).toEqual({ flick: "inward heel" });
  expect(resolve(100, 100)).toEqual({ flick: "tre flip" });
  expect(resolve(-100, 100)).toEqual({ flick: "laser flip" });
  expect(resolve(60, -60)).toEqual({ jump: true, flick: "varial" });
  expect(resolve(-60, -60)).toEqual({ jump: true, flick: "varial heel" });
  const g = new Gestures();
  g.down(0, 0); g.up(60, 60);
  expect(g.take()).toEqual({ flick: "hardflip" });
});

test("the approach angle and side name seven grinds", () => {
  const names = new Set([grindKind(0, 1), grindKind(0.7, 1), grindKind(0.7, -1), grindKind(1, 1), grindKind(1, -1), grindKind(Math.PI / 2, 1), grindKind(Math.PI / 2, -1)]);
  expect([...names].sort() as string[]).toEqual(["50-50", "5-0", "boardslide", "feeble", "lipslide", "nosegrind", "smith"].sort());
});

test("a grind lands and scores as a smith grind when the board comes in nearly across the bar", () => {
  const lv = flat({ rails: [{ kind: "rail", a: { x: 0, z: 0 }, b: { x: 0, z: 60 }, y: 0.9 }] });
  const sk = start(-0.2, 2, 1, lv);
  sk.air = true; sk.y = 1.0; sk.vy = -1; sk.vx = Math.sin(1) * 4; sk.vz = Math.cos(1) * 4;
  for (let i = 0; i < 0.6 / DT; i++) step(sk, { ...IDLE, steer: Math.max(-1, Math.min(1, sk.balance * 2)) }, lv);
  expect(sk.grindKind).toBe("smith");
  step(sk, { ...IDLE, jump: true }, lv);
  expect(sk.last?.name).toBe("Smith grind");
});

test("a rock ridge and a rock slab carry ledges that sit on the stone", () => {
  for (const part of [rockRidge({ x: 0, z: 0 }), rockSlab({ x: 0, z: 0 })]) {
    expect(part.rails.length).toBeGreaterThan(0);
    const p = part.pieces[0]!;
    for (const r of part.rails) for (const t of [0, 0.5, 1]) {
      const x = r.a.x + (r.b.x - r.a.x) * t, z = r.a.z + (r.b.z - r.a.z) * t;
      expect(railY(r, t)).toBeCloseTo(p.height(x - p.x, z - p.z), 1);
    }
  }
});

test("the kidney, the keyhole and the terraced pit are dug below the meadow with their lips on the deck", () => {
  for (const e of [kidney({ x: 0, z: 0, yaw: 0 }, 0), keyhole({ x: 0, z: 0, yaw: 0 }, 0), terraced({ x: 0, z: 0, yaw: 0 }, 0)]) {
    let deepest = 0;
    for (let x = -e.w / 2; x <= e.w / 2; x += 1) for (let z = -e.d / 2; z <= e.d / 2; z += 1) deepest = Math.min(deepest, e.shape(x, z));
    expect(deepest).toBeLessThan(-2);
    expect(e.shape(e.w / 2 - 0.5, e.d / 2 - 0.5)).toBeCloseTo(0, 5); // the corner is deck
  }
  expect(terraced({ x: 0, z: 0, yaw: 0 }, 0).rails.length).toBeGreaterThanOrEqual(4); // a lip to grind on each terrace
});
