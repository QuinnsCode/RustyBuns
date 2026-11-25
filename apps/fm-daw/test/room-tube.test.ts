// The room hears a YouTube deck (src/dj/room-tube.ts): the DJ's deck says its video on the booth's line, and a
// listener's own player follows it on the room's clock, at the DJ's volume times the PA's level where they stand.
// The players are YouTube's (no network in the test), so this drives the step each frame takes against a player that does what it's told.
import { expect, test } from "bun:test";
import { check } from "@rustybuns/util/guard";
import { DeckSay, tubeSayOf } from "../src/dj/booth.ts";
import { DRIFT_S, SEEK_LEAD_S, SETTLE_MS, tubeStep } from "../src/dj/room-tube.ts";
import { paSpeakers, roomLevel } from "../src/studio/pa-room.ts";
import { DESERT_GATHERING } from "../src/studio/rooms/desert-gathering.ts";

const ID = "M7lc1UVf-VE";

test("a YouTube deck's say carries its video and volume over the line; a bad id doesn't get through", () => {
  const say = tubeSayOf(0, { id: ID, name: "A video", len: 200, pos: 12, cue: 0, playing: true, rate: 1.25, vol: 80.4 }, 5000);
  expect(check(DeckSay, say)).toEqual({ ...say, vol: 80 });
  expect(check(DeckSay, { ...say, tube: "not a video id!" })).toBeNull();
  // a live stream's hours-long length still fits the line
  expect(check(DeckSay, tubeSayOf(1, { id: ID, name: "Live", len: 9e5, pos: 9e5, cue: 0, playing: true, rate: 1, vol: 100 }, 0))?.len).toBe(6 * 3600);
});

test("a listener's player joins late, keeps up on the room's clock, follows a stop, and lets small drift be", () => {
  // the DJ pressed play at 10 s into the video at room time 0, at 1.25x, channel at 80
  const say = tubeSayOf(0, { id: ID, name: "A video", len: 200, pos: 10, cue: 0, playing: true, rate: 1.25, vol: 80 }, 0);
  const p = { pos: 0, moving: false };
  let seekAt = -Infinity;
  const frame = (now: number, level = 1) => {
    const s = tubeStep(say, now, p, now - seekAt, level);
    if (s.seek !== null) { p.pos = s.seek; seekAt = now; }
    p.moving = s.play;
    return s;
  };
  // joining 4 s in: it jumps to where the DJ's is (15 s), a little ahead for the seek to land, at the DJ's speed and volume
  expect(frame(4000)).toEqual({ play: true, seek: 15 + SEEK_LEAD_S * 1.25, rate: 1.25, volume: 80 });
  // playing along: a tenth of a second off is left alone
  p.pos = 15 + 1.25 * 2 + 0.1;
  expect(frame(6000).seek).toBeNull();
  // a stall puts it a second behind: it seeks again, but not before the last seek has settled
  p.pos = 15 + 1.25 * 1 - 1;
  expect(tubeStep(say, 5000, p, SETTLE_MS - 1, 1).seek).toBeNull();
  expect(frame(4000 + SETTLE_MS + 1000)).toMatchObject({ seek: expect.any(Number) });
  expect(Math.abs(p.pos - (10 + 1.25 * (4 + SETTLE_MS / 1000 + 1)))).toBeLessThan(DRIFT_S);
  // the DJ stops at 30 s: the player pauses on that spot; muted, it plays at no volume
  const stopped = { ...say, playing: false, pos: 30, at: 20000 };
  expect(tubeStep(stopped, 30000, { pos: 31, moving: true }, 1e9, 0)).toEqual({ play: false, seek: 30, rate: 1.25, volume: 0 });
});

test("the PA's level for a YouTube deck: full on the floor, down close in between the sides, further back and behind the stacks", () => {
  const speakers = paSpeakers(DESERT_GATHERING), dj = DESERT_GATHERING.spots.find((s) => s.kind === "dj")!;
  const mx = speakers.reduce((t, s) => t + s.at[0], 0) / speakers.length, mz = speakers.reduce((t, s) => t + s.at[1], 0) / speakers.length;
  // out in front of the stacks (the way the crowd stands), facing them, against behind the DJ
  const fx = Math.sin(speakers[0]!.yaw), fz = Math.cos(speakers[0]!.yaw), yaw = Math.atan2(fx, fz);
  const at = (m: number) => roomLevel(speakers, { x: mx + fx * m, z: mz + fz * m, yaw });
  // full across the floor where the toed-in sides' horns cross; close in, between the sides, is the gap they leave
  // (the builder's coverage map shows it too: @rustybuns/gear's horn pattern)
  expect(at(10)).toBeCloseTo(1, 1);
  expect(at(15)).toBe(1);
  expect(at(3)).toBeLessThan(0.5);
  expect(at(25)).toBeLessThan(at(10));
  expect(roomLevel(speakers, { x: mx - fx * 4, z: mz - fz * 4, yaw: dj.yaw })).toBeLessThan(at(10));
  expect(roomLevel([], { x: 0, z: 0, yaw: 0 })).toBe(1);
});
