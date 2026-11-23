// The PA heard from the floor (src/studio/pa-room.ts): level by the inverse square law, the speed of sound's delay,
// the air's highs, and a speaker behind you quieter; and Desert Gathering's stacks as the speakers it plays from.
import { expect, test } from "bun:test";
import { EAR_Y, HORN_Y, hearSpeaker, paSpeakers, SOUND_SPEED, type Speaker } from "../src/studio/pa-room.ts";
import { DESERT_GATHERING } from "../src/studio/rooms/desert-gathering.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";

// a stack at the origin facing +z, the floor in front of it
const stack: Speaker = { at: [0, 0], yaw: 0, side: 0 };
const facing = (z: number) => hearSpeaker(stack, { x: 0, z, yaw: 0 }); // yaw 0 looks down -z: at the stack

test("twice as far is 6 dB down and arrives twice as late, with fewer highs", () => {
  const near = facing(10), far = facing(20);
  const m = (z: number) => Math.hypot(z, HORN_Y - EAR_Y);
  expect(20 * Math.log10(far.gain / near.gain)).toBeCloseTo(20 * Math.log10(m(10) / m(20)), 5); // about -6 dB
  expect(near.delay * 1000).toBeCloseTo(m(10) / SOUND_SPEED * 1000, 5); // about 29 ms
  expect(far.delay / near.delay).toBeCloseTo(m(20) / m(10), 5);
  expect(far.cutoff).toBeLessThan(near.cutoff);
});

test("a speaker behind you is quieter and duller than the same one in front", () => {
  const front = facing(10), behind = hearSpeaker(stack, { x: 0, z: 10, yaw: Math.PI });
  expect(behind.gain).toBeLessThan(front.gain);
  expect(behind.cutoff).toBeLessThan(front.cutoff);
  expect(behind.delay).toBe(front.delay);
  // and standing behind the stack itself, its horns throw away from you
  expect(hearSpeaker(stack, { x: 0, z: -10, yaw: 0 }).gain).toBeLessThan(behind.gain);
});

test("Desert Gathering plays from its four stacks, the left pair on the floor's left; a room without decks has no PA", () => {
  const sp = paSpeakers(DESERT_GATHERING);
  expect(sp.map((s) => [s.at[0], s.side])).toEqual([[-9.6, 0], [-8.4, 0], [8.4, 1], [9.6, 1]]);
  // on the floor, facing the stage, the left stacks are on your left
  const ears = { x: 0, z: 4, yaw: 0 };
  expect(hearSpeaker(sp[0], ears).pan).toBeLessThan(0);
  expect(paSpeakers(LIVE_ROOM)).toEqual([]);
});
