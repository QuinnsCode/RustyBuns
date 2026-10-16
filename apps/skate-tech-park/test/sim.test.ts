// Journeys through the ride, headless: the same fixed-step sim the page draws.
import { expect, test } from "bun:test";
import { hitObstacle, type Level, makeLevel, piece, railY } from "../src/level.ts";
import { quarterPipe } from "../src/levels/pieces.ts";
import { DT, IDLE, type Input, SCALE, start, step, type State, tumble } from "../src/sim.ts";

const run = (s: State, seconds: number, input: (s: State) => Partial<Input>, level?: Level) => {
  for (let i = 0; i < seconds / DT; i++) step(s, { ...IDLE, ...input(s) }, level);
  return s;
};

test("rear jets carry the board over the gap that a standing start can't clear", () => {
  const boosted = run(start(27, -38), 5, () => ({ throttle: 1, boost: true }));
  expect(boosted.last?.name).not.toMatch(/Bail/);
  expect(boosted.z).toBeGreaterThan(-2); // past the gap
  expect(boosted.last?.points).toBeGreaterThan(0);

  const pushed = run(start(27, -20), 3, () => ({ throttle: 1 }));
  expect(pushed.z).toBeLessThan(-2); // with no run-up it is too slow: it rolled back off the kicker, or fell in
});

test("the jets fire in time with the board: lift on a pop, corners on a flip, nose on a spin, rear on a push, a burst on landing", () => {
  const sk = start(0, -20);
  const seen = { rear: false, lift: false, roll: 0, spin: 0, landed: false };
  const watch = (s: State) => {
    seen.rear ||= s.firing.rear; seen.lift ||= s.firing.lift; seen.roll ||= s.firing.roll; seen.spin ||= s.firing.spin;
  };
  run(sk, 1, (s) => { watch(s); return { throttle: 1 }; });
  expect(seen).toMatchObject({ rear: true, lift: false, roll: 0, spin: 0 }); // pushing: the rear jets only
  run(sk, 0.1, (s) => ({ throttle: 1, jump: s.t < 1.01 }));
  expect(sk.firing.lift).toBe(true); // the pop
  run(sk, 0.3, (s) => { watch(s); return { flick: s.air && !s.flipT ? "kickflip" : null }; });
  expect(seen.roll).toBe(1); // corners, unevenly
  run(sk, 3, (s) => { if (s.firing.lift && !s.air) seen.landed = true; watch(s); return { steer: s.air && s.spun < Math.PI ? 1 : 0 }; });
  expect(seen.spin).toBe(1);
  expect(seen.landed).toBe(true); // the landing cushion
});

test("the skin changes nothing: one run replayed with each skin gives identical state", () => {
  const ride = (skin: "skate" | "car") => {
    const s = start(-12, -20);
    const log: string[] = [];
    run(s, 6, (st) => {
      void skin; // the page's skin is not an input to step(): nothing here can differ
      log.push(JSON.stringify(st));
      return { throttle: 1, boost: st.t > 2, jump: st.t > 3 && st.t < 3.05, steer: st.air ? 1 : 0.2 };
    });
    return log;
  };
  expect(ride("skate")).toEqual(ride("car"));
});

test("a skater ollies onto the rail, grinds it, and kickflips out of the grind", () => {
  const sk = start(-12, -18);
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
  const sk = start(0, -20);
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

  const sk = start(-8, -8, Math.PI / 4, diag);
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
  const hit = run(start(0, 0, 0, lv), 3, () => ({ throttle: 1 }), lv);
  expect(hit.z).toBeLessThan(9);
  expect(hit.last?.name).toBe("Hit a tree");
  const past = run(start(4, 0, 0, lv), 3, () => ({ throttle: 1 }), lv);
  expect(past.z).toBeGreaterThan(20);
});

test("a tree catches the board's edge, not a circle round its middle", () => {
  const lv = flat({ obstacles: [{ x: 0, z: 10, r: 0.5, tall: 30 }] });
  expect(hitObstacle(lv, 0.9, 9.5, 0, 0)).toBeUndefined(); // heading at it, 0.9 m to the side: clear
  expect(hitObstacle(lv, 0.9, 9.5, 0, Math.PI / 2)).toBeDefined(); // turned across: the long edge reaches it
  expect(hitObstacle(lv, 0, 8.8, 0, 0)).toBeDefined(); // the nose catches it 1.2 m out, before the centre could
});

test("a skater grinds a rail down a slope and stays on the bar", () => {
  const lv = flat({ rails: [{ kind: "rail", a: { x: 0, z: 0 }, b: { x: 0, z: 10 }, y: 2, y2: 0.5 }] });
  const sk = start(0, -2, 0, lv);
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
  const car = start(0, -2, 0, ramp);
  let maxY = 0;
  run(car, 3, (s) => { maxY = Math.max(maxY, s.y); return { throttle: 1, boost: true }; }, ramp);
  expect(maxY).toBeGreaterThan(2);
  const wall = flat({ pieces: [piece("box", "b", 0, 10, 0, 6, 4, 1, 1)] });
  const c2 = run(start(0, 0, 0, wall), 3, () => ({ throttle: 1 }), wall);
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
    const sk = start(0, -10, 0, level);
    sk.speed = 5;
    run(sk, 1, () => ({}), level);
    return sk;
  };
  const onHill = across(hill), onFlat = across(flat);
  expect(onFlat.vx).toBeCloseTo(0, 3); // straight on flat ground stays straight
  expect(onHill.vx).toBeLessThan(-0.3); // turned toward -x, the way down
  expect(onHill.roll).not.toBe(0);

  const carve = (steer: number) => run(Object.assign(start(0, -10, 0, flat), { speed: 9 }), 1, () => ({ steer }), flat).speed;
  expect(carve(1)).toBeLessThan(carve(0));
});

// A quarter pipe vertical at the lip, rising toward +z from a flat run-in.
const pipe = quarterPipe({ x: 0, z: 0 }, { w: 6, d: 4, h: 2, deck: 3 });
const pipeLevel = flat({ pieces: pipe.pieces, rails: pipe.rails });

test("a skater pumping the transition rides higher than one rolling it", () => {
  const peak = (pump: boolean) => {
    const sk = Object.assign(start(0, -6, 0, pipeLevel), { speed: 9 });
    let max = 0;
    run(sk, 4, (s) => { max = Math.max(max, s.y); return { boost: pump }; }, pipeLevel);
    return max;
  };
  expect(peak(true)).toBeGreaterThan(peak(false) + 0.15);
});

test("a skater rides up the wall, goes up past the coping and drops back down it", () => {
  const sk = Object.assign(start(0, -6, 0, pipeLevel), { speed: 10 });
  let flew = false;
  run(sk, 5, (s) => { flew ||= s.air && s.y > 1.5; return { throttle: 1, boost: true }; }, pipeLevel);
  expect(flew).toBe(true);
  expect(sk.last?.name).not.toMatch(/Bail/);
  expect(sk.bail).toBeLessThanOrEqual(0);
});

test("the board never passes through a vertical ramp, slow or fast: it rides the wall, or flies off the lip", () => {
  for (const speed of [8, 14, 25, 40]) {
    const sk = Object.assign(start(0, -12, 0, pipeLevel), { speed });
    let inside = 0, top = 0;
    run(sk, 4, (s) => { inside = Math.max(inside, pipeLevel.height(s.x, s.z) - s.y); top = Math.max(top, s.y); return { throttle: 1 }; }, pipeLevel);
    expect(inside).toBeLessThan(0.01);
    expect(top).toBeGreaterThan(2); // up the wall and over the lip, not bounced back at the foot of it
  }
});

test("a bigger board is a bigger toy: an ollie goes SCALE times as high and hangs sqrt(SCALE) times as long", () => {
  const sk = start(0, -20);
  let apex = 0, hang = 0;
  run(sk, 3, (s) => { apex = Math.max(apex, s.y); if (s.air) hang += DT; return { jump: s.t < 0.05 }; });
  const g = 20, base = 7; // the numbers the board was cut for at SCALE 1
  expect(apex).toBeCloseTo(SCALE * (base * base) / (2 * g), 0);
  expect(hang).toBeCloseTo(Math.sqrt(SCALE) * (2 * base) / g, 1);
});

test("a push is gentle and tops out at a speed you can steer at, while the jets and a downhill still carry the board past it", () => {
  const flatLv = makeLevel({ name: "f", pieces: [], rails: [], spawns: [], bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 } });
  const kmh = (s: State) => s.speed * 3.6;

  const pushed = run(start(0, -100, 0, flatLv), 3, () => ({ throttle: 1 }), flatLv);
  expect(kmh(pushed)).toBeGreaterThan(40); // it does get going
  expect(kmh(pushed)).toBeLessThan(75); // but not 150 km/h in 3 s
  run(pushed, 10, () => ({ throttle: 1 }), flatLv);
  expect(kmh(pushed)).toBeLessThan(75); // and pushing alone stops there

  const jets = run(start(0, -100, 0, flatLv), 3, () => ({ throttle: 1, boost: true }), flatLv);
  expect(kmh(jets)).toBeGreaterThan(110); // the jets are the real speed

  const hill = makeLevel({ name: "h", pieces: [piece("ramp", "slope", 0, 0, Math.PI, 20, 400, 0, 120)], rails: [], spawns: [], bounds: { minX: -300, maxX: 300, minZ: -400, maxZ: 400 } });
  const down = run(start(0, -198, 0, hill), 10, () => ({}), hill); // heading downhill, no push at all
  expect(kmh(down)).toBeGreaterThan(75); // gravity carries it past what pushing reaches
});

test("a bad landing carries on: the rider slides and rolls across the ground, slowing, before standing up", () => {
  const sk = start(0, -20);
  run(sk, 2.5, (s) => ({ throttle: s.t < 1.5 ? 1 : 0, jump: s.t > 1.5 && s.t < 1.55, steer: s.air && s.spun < Math.PI / 2 ? 1 : 0 }));
  expect(sk.bail).toBeGreaterThan(0);
  const z0 = sk.z, v0 = Math.hypot(sk.vx, sk.vz);
  expect(v0).toBeGreaterThan(1); // not stopped dead
  run(sk, 0.4, () => ({}));
  expect(Math.abs(sk.z - z0) + Math.abs(sk.x)).toBeGreaterThan(0.3);
  expect(Math.hypot(sk.vx, sk.vz)).toBeLessThan(v0);
  expect(Math.abs(tumble(sk).roll)).toBeGreaterThan(1.3); // mid-roll, not lying still
  run(sk, 1.2, () => ({}));
  expect(tumble(sk).roll).toBe(0);
});
