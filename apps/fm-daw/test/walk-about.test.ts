// Walking about a room: an easy walk, Shift's speed walk, a hop everyone else sees, and the lantern in your hand
// swinging on its handle as you go and stop. Two jams on one live line, no DOM.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { BRISK, WALK, body, hear, hop, newJam, sit, step } from "../src/studio/jam.ts";
import { Swing, WEIGHT } from "../src/studio/lanterns.ts";
import { DESERT_GATHERING } from "../src/studio/rooms/desert-gathering.ts";

const tick = 1 / 60;
const run = (j: ReturnType<typeof newJam>, s: number, brisk = false) => { for (let t = 0; t < s; t += tick) step(j, tick, { forward: 1, right: 0, turn: 0, brisk }); };

test("Shift speed walks, Space hops a little and lands, and the other people in the room see the hop", () => {
  const me = newJam(DESERT_GATHERING), them = newJam(DESERT_GATHERING);
  // turned toward the open middle of the room, so nothing stops the walk
  me.me.yaw = Math.atan2(me.me.x, me.me.z);
  const start = { x: me.me.x, z: me.me.z };
  run(me, 0.5);
  const walked = Math.hypot(me.me.x - start.x, me.me.z - start.z);
  const was = { x: me.me.x, z: me.me.z };
  run(me, 0.5, true);
  const brisk = Math.hypot(me.me.x - was.x, me.me.z - was.z);
  expect(walked).toBeCloseTo(WALK * 0.5, 1);
  expect(brisk).toBeCloseTo(BRISK * 0.5, 1);

  expect(hop(me)).toBe(true);
  expect(hop(me)).toBe(false);          // no second hop in the air
  let top = 0;
  for (let t = 0; t < 0.15; t += tick) { step(me, tick, { forward: 0, right: 0, turn: 0 }); top = Math.max(top, me.me.y); }
  hear(them, 7, body(me));
  expect(them.others.get(7)?.hop).toBeGreaterThan(0.1);
  for (let t = 0; t < 1; t += tick) { step(me, tick, { forward: 0, right: 0, turn: 0 }); top = Math.max(top, me.me.y); }
  expect(top).toBeGreaterThan(0.15);
  expect(top).toBeLessThan(0.4);        // a slight hop, not a jump
  expect(me.me.y).toBe(0);
  hear(them, 7, body(me));
  expect(them.others.get(7)?.hop).toBe(0);

  // seated, Space stands you up instead: no hopping off a stool
  const seat = DESERT_GATHERING.spots[0]!;
  Object.assign(me.me, { x: seat.at[0], z: seat.at[1] });
  expect(sit(me, seat.id).ok).toBe(true);
  expect(hop(me)).toBe(false);
});

test("a carried lantern is heavy: it hangs straight on a steady walk, sways a little past the hand when you stop, and settles soon", () => {
  const swing = new Swing(), hand = new THREE.Vector3(0, 0.8, 0);
  swing.step(hand, tick);
  // walk forward (-z) for a second: once past the first lurch it hangs near straight down, the rope's length holding
  let walking = 0;
  for (let t = 0; t < 1; t += tick) { hand.z -= WALK * tick; swing.step(hand, tick); if (t > 0.8) walking = Math.max(walking, swing.angle(hand)); }
  expect(swing.bob.distanceTo(hand)).toBeCloseTo(WEIGHT, 5);
  expect(walking).toBeLessThan(0.1);
  // stop: it swings on ahead of the hand, but not far
  let ahead = 0, most = 0;
  for (let t = 0; t < 0.6; t += tick) { swing.step(hand, tick); ahead = Math.max(ahead, hand.z - swing.bob.z); most = Math.max(most, swing.angle(hand)); }
  expect(ahead).toBeGreaterThan(0.03);
  expect(most).toBeLessThanOrEqual(Swing.MAX + 1e-6);
  // and within a second and a half it hangs still, straight down
  for (let t = 0; t < 0.9; t += tick) swing.step(hand, tick);
  expect(swing.angle(hand)).toBeLessThan(0.05);
});
