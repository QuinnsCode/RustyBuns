// Reverts and switch: steer held as the wheels touch pivots the board round on landing, a half turn that lands rolling
// backwards is switch. Headless, through the same step() the page runs.
import { expect, test } from "bun:test";
import { DT, IDLE, type Input, start, step, type State } from "../src/sim.ts";

/** A long hop on the flat: turned `half` half-turns in the air (the board swung round under a rider still travelling the same way), `onLand` held on touching down. */
function jump(half: number, onLand: Partial<Input>) {
  const s = start(0, 0, 0);
  s.speed = 6;
  step(s, { ...IDLE, jump: true });
  s.vy = 8; // a higher pop than a flat ollie, so the air is long enough to score
  s.yaw += half * Math.PI; s.spun = half * Math.PI;
  const seen: string[] = [];
  let last = s.last;
  for (let i = 0; i < 2 / DT; i++) {
    step(s, { ...IDLE, ...(!s.air || s.vy < 0 && s.y < 0.5 ? onLand : {}) }); // held just as it comes down
    if (s.last !== last) { last = s.last; seen.push(last!.name); }
  }
  return { s, seen };
}

test("steer and brake held as the wheels touch is a revert: a link after the air, and the board ends rolling fakie", () => {
  expect(jump(0, {}).seen).toHaveLength(1);
  expect(jump(0, { steer: 1 }).seen).toHaveLength(1); // steer alone is just carving on
  const rev = jump(0, { steer: 1, throttle: -1 });
  expect(rev.seen[0]).toMatch(/^Air/);
  expect(rev.seen[1]).toMatch(/^Revert/);
  expect(rev.s.speed).toBeLessThan(0);
});

test("a half turn that lands rolling backwards is switch, and rolling forward again clears it", () => {
  const sw = jump(1, {});
  expect(sw.seen[0]).toMatch(/^backside switch|^frontside switch|^switch/);
  expect(sw.s.switched).toBe(true);
  expect(jump(0, {}).s.switched).toBe(false);
});
