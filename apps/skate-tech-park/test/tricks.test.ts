// Journeys for the tricks: gestures into flicks, grinds by approach angle with balance, bails and the
// combo chain, and the roadster's suction fan. All headless, through the same step() the page runs.
import { expect, test } from "bun:test";
import { clamp } from "@rustybuns/util";
import { Gestures, resolve } from "../src/gesture.ts";
import { type Level, makeLevel, piece, type RailKind } from "../src/level.ts";
import { DT, IDLE, type Input, start, step, type State } from "../src/sim.ts";
import { comboLine } from "../src/render/combo.ts";
const run = (s: State, seconds: number, input: (s: State) => Partial<Input>, level?: Level) => {
  for (let i = 0; i < seconds / DT; i++) step(s, { ...IDLE, ...input(s) }, level);
  return s;
};
const flat = (extra: Partial<Parameters<typeof makeLevel>[0]> = {}) => makeLevel({
  name: "t", pieces: [], rails: [], spawns: [], bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 }, ...extra,
});

test("a mouse drag up ollies, then a drag across in the air flicks a heelflip that lands", () => {
  const g = new Gestures();
  const sk = Object.assign(start(0, 0), { speed: 6 });
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
  const sk = start(-Math.sin(yaw) * 0.2, 2, yaw, lv);
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
    const sk = start(0, 2, 0, lv);
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
    const sk = start(0, 2, 0, lv);
    sk.air = true; sk.y = 1.0; sk.vy = -1; sk.vz = 6;
    return run(sk, 1.5, (s) => ({ steer: Math.max(-1, Math.min(1, s.balance * 2)) }), lv).speed;
  };
  expect(speedAfter("ledge")).toBeGreaterThan(speedAfter("rail"));
});

test("tricks landed in a row multiply, and a bail ends the chain", () => {
  const sk = Object.assign(start(0, 0), { speed: 5 });
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
  const sk = Object.assign(start(0, 0), { speed: 5 });
  run(sk, 1.5, (s) => ({ jump: !s.air && s.t < 0.1 }));
  expect(sk.chain).toBe(1);
  run(sk, 5, () => ({}));
  expect(sk.chain).toBe(0);
});

test("the suction fan holds the roadster to a lip it would otherwise fly off, and drives it up a box side", () => {
  const kicker = flat({ pieces: [piece("ramp", "kicker", 0, 10, 0, 6, 6, 0, 2)] });
  const drive = (fan: boolean) => {
    const car = start(0, -2, 0, kicker);
    let airborne = false;
    run(car, 2.5, (s) => { airborne ||= s.air; return { throttle: 1, fan }; }, kicker);
    return { car, airborne };
  };
  expect(drive(false).airborne).toBe(true);
  const held = drive(true);
  expect(held.airborne).toBe(false);

  const box = flat({ pieces: [piece("box", "b", 0, 10, 0, 6, 4, 1.2, 1.2)] });
  const without = run(start(0, 0, 0, box), 3, () => ({ throttle: 1 }), box);
  expect(without.z).toBeLessThan(8.5);
  let top = 0;
  run(start(0, 0, 0, box), 3, (s) => { top = Math.max(top, s.y); return { throttle: 1, fan: true }; }, box);
  expect(top).toBeCloseTo(1.2, 1);
});

test("a held manual scores when you let go, falls over if left alone, and links into the next trick's chain", () => {
  const lv = flat();
  const hold = (s: State) => clamp(s.balance * 2 + 0.1, -1, 1); // push or brake against the tip
  const roll = () => { const s = start(0, -40, 0, lv); s.speed = 8; return s; };

  const sk = roll();
  run(sk, 2.5, (s) => ({ manual: 1, throttle: hold(s) }), lv);
  expect(sk.manual).toBe(1);
  run(sk, 0.05, () => ({}), lv); // let go
  expect(sk.last?.name).toBe("Manual");
  expect(sk.last?.points).toBeGreaterThan(300);

  const nose = roll();
  run(nose, 2.5, (s) => ({ manual: -1, throttle: -hold(s) }), lv);
  run(nose, 0.05, () => ({}), lv);
  expect(nose.last?.name).toBe("Nose manual");

  const left = roll();
  run(left, 2.2, () => ({ manual: 1 }), lv);
  expect(left.last?.name).toMatch(/Bail: lost the manual/);
  expect(left.bail).toBeGreaterThan(0);

  // a manual, then an ollie and a kickflip: the second trick is multiplied by the chain
  const link = roll();
  run(link, 2.5, (s) => ({ manual: 1, throttle: hold(s) }), lv);
  run(link, 2, (s) => ({ jump: s.t < 2.56 && !s.air, flick: s.air && !s.flipT && !s.tricks.length ? "kickflip" : null }), lv);
  expect(link.chain).toBe(2);
  expect(link.last?.name).toMatch(/kickflip x2/);
});

test("holding the mouse still, or a pad trigger, holds a manual; a quick drag is still a flick", () => {
  const g = new Gestures();
  g.down(100, 100, 0);
  expect(g.manual(0.1)).toBe(0); // not held long enough yet
  expect(g.manual(0.5)).toBe(1);
  g.move(100, 120);
  expect(g.manual(0.6)).toBe(-1); // nudged down: the nose
  g.move(100, 160);
  expect(g.manual(0.7)).toBe(0); // a long drag is a flick, not a hold
  g.up(100, 160);
  expect(g.take()).toEqual({ flick: "shove-it" });
  g.shoulders(0.9, 0);
  expect(g.manual(1)).toBe(-1);
  g.shoulders(0, 0.9);
  expect(g.manual(1)).toBe(1);

  const lv = flat(), sk = start(0, -40, 0, lv);
  sk.speed = 8;
  const pad = new Gestures();
  pad.shoulders(0, 1);
  run(sk, 1, (s) => ({ manual: pad.manual(s.t), throttle: clamp(s.balance * 2 + 0.1, -1, 1) }), lv);
  expect(sk.manual).toBe(1);
});

test("grind into manual is one chain, and a different kind of trick scores a link bonus over a repeat", () => {
  const hold = (s: State) => clamp(s.balance * 2 + 0.1, -1, 1);

  // a 50-50 down a short rail, off its end, and straight into a manual
  const lv = flat({ rails: [{ kind: "rail", a: { x: 0, z: 0 }, b: { x: 0, z: 8 }, y: 0.9 }] });
  const sk = start(0, 2, 0, lv);
  sk.air = true; sk.y = 1.0; sk.vy = -1; sk.vz = 6; // dropped onto the bar
  run(sk, 2.2, (s) => ({ steer: clamp(s.balance * 2, -1, 1), manual: s.grind < 0 ? 1 : 0, throttle: s.grind < 0 ? hold(s) : 0 }), lv);
  expect(sk.manual).toBe(1);
  expect(sk.combo).toEqual(["50-50 grind"]);
  run(sk, 0.05, () => ({}), lv); // let go
  expect(sk.combo).toEqual(["50-50 grind", "Manual"]);
  expect(sk.chain).toBe(2);
  expect(sk.last?.name).toMatch(/Manual x2 link/);
  expect(sk.comboScore).toBe(sk.score);

  // the same manual twice in a row is multiplied by the chain but gets no link bonus
  const flatLv = flat(), twice = start(0, -40, 0, flatLv);
  twice.speed = 8;
  const manual = (secs: number) => {
    run(twice, secs, (s) => ({ manual: 1, throttle: hold(s) }), flatLv);
    run(twice, 0.05, () => ({}), flatLv);
  };
  manual(1.6);
  const first = twice.score;
  run(twice, 1, () => ({ throttle: 1 }), flatLv);
  manual(1.6);
  expect(twice.chain).toBe(2);
  expect(twice.last?.name).toBe("Manual x2");
  expect(twice.score - first).toBeLessThan(Math.round(1.7 * 150 * 2 * 1.5)); // x2 for the chain, not x3 for a link
});

test("the HUD's combo line follows a real chain: grind into manual, and it clears when the chain ends", () => {
  const hold = (s: State) => clamp(s.balance * 2 + 0.1, -1, 1);
  const lv = flat({ rails: [{ kind: "rail", a: { x: 0, z: 0 }, b: { x: 0, z: 8 }, y: 0.9 }] });
  const sk = start(0, 2, 0, lv);
  sk.air = true; sk.y = 1.0; sk.vy = -1; sk.vz = 6;
  run(sk, 2.2, (s) => ({ steer: clamp(s.balance * 2, -1, 1), manual: s.grind < 0 ? 1 : 0, throttle: s.grind < 0 ? hold(s) : 0 }), lv);
  run(sk, 0.05, () => ({}), lv);
  expect(comboLine(sk.combo, sk.comboScore)).toBe(`50-50 grind > Manual   ${sk.comboScore}`);
  expect(comboLine([], 0)).toBe("");
  expect(comboLine(["Ollie", "Ollie", "Ollie", "Kickflip"], 400)).toBe("Ollie x3 > Kickflip   400"); // a repeat folds
  expect(comboLine(["a", "b", "c", "d", "e", "f", "g"], 9)).toBe("... c > d > e > f > g   9"); // old ones scroll off
  run(sk, 4, () => ({}), lv); // the chain's clock runs out on the ground
  expect(comboLine(sk.combo, sk.comboScore)).toBe("");
});
