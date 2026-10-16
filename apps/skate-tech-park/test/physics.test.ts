// The board keeps its energy: a transition gives back what it takes, a landing keeps the speed along the
// ground, and a vert wall throws the board straight up to drop back in.
import { expect, test } from "bun:test";
import { makeLevel, piece } from "../src/level.ts";
import { halfpipe, quarterPipe } from "../src/levels/pieces.ts";
import { DT, IDLE, type Input, start, step, type State } from "../src/sim.ts";

const flat = (extra: Partial<Parameters<typeof makeLevel>[0]>) => makeLevel({
  name: "t", pieces: [], rails: [], spawns: [], bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, ...extra,
});
const run = (s: State, seconds: number, level: ReturnType<typeof flat>, input: (s: State) => Partial<Input> = () => ({}), each?: (s: State) => void) => {
  for (let i = 0; i < seconds / DT; i++) { step(s, { ...IDLE, ...input(s) }, level); each?.(s); }
  return s;
};

test("rolling across a halfpipe it rides wall to wall, each wall a little lower", () => {
  const level = flat({ pieces: halfpipe({ x: 0, z: 0 }, {}).pieces });
  const p: number[] = [];
  let peak = 0, side = 0;
  run(Object.assign(start(0, 0, Math.PI / 2, level), { speed: 16 }), 12, level, () => ({}), (s) => {
    peak = Math.max(peak, s.y);
    if (Math.sign(s.x) !== side && Math.abs(s.x) > 0.5) { if (side) p.push(peak); peak = 0; side = Math.sign(s.x); }
  });
  expect(p.length).toBeGreaterThanOrEqual(3); // back and forth, not stopped on the first wall
  expect(p[0]).toBeGreaterThan(4.5); // 16 m/s climbs most of the way to v²/2g = 6.4 m
  expect(p[1]).toBeGreaterThan(p[0] * 0.5); // the second wall gets well over half the first
  expect(p[1]).toBeLessThan(p[0]); // and nothing comes for free
});

test("fast up a vert wall the board flies straight up past the coping and drops back in, riding away fakie", () => {
  const level = flat({ pieces: quarterPipe({ x: 0, z: 0 }, { w: 6, d: 4, h: 2, deck: 3 }).pieces });
  const s = Object.assign(start(0, -12, 0, level), { speed: 15 });
  let top = 0;
  run(s, 5, level, () => ({}), (st) => { top = Math.max(top, st.y); });
  expect(top).toBeGreaterThan(4); // the wall is 4 m tall
  expect(s.last?.name).not.toMatch(/Bail/);
  expect(s.speed).toBeLessThan(-5); // rolling back out of it fast
  expect(s.z).toBeLessThan(-10);
});

test("a drop onto a slope rolls away with the speed the fall gave it, not just what it had across the ground", () => {
  const level = flat({ pieces: [piece("ramp", "hill", 0, 0, Math.PI, 40, 120, 0, 60)] }); // falls toward +z
  const s = start(0, -20, 0, level);
  Object.assign(s, { air: true, y: level.height(0, -20) + 6, vz: 5, vy: 0 });
  while (s.air) step(s, IDLE, level);
  expect(s.last?.name ?? "").not.toMatch(/Bail/);
  expect(s.speed).toBeGreaterThan(12); // about 14.7 m/s down the slope from a 6 m fall at 5 m/s
});
