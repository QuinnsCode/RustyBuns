// The PA heard from the floor (src/studio/pa-room.ts): level by the inverse square law, the speed of sound's delay,
// the air's highs, and a speaker behind you quieter; and Desert Gathering's stacks as the speakers it plays from: one mono point source.
import { expect, test } from "bun:test";
import { EAR_Y, HORN_Y, hearSpeaker, paSpeakers, SOUND_SPEED, type Speaker } from "../src/studio/pa-room.ts";
import { DESERT_GATHERING } from "../src/studio/rooms/desert-gathering.ts";
import { SYSTEM_IDS, SYSTEMS, stackWidth, type SystemId } from "@rustybuns/gear";
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

test("Desert Gathering plays one mono sum from a single wall of stacks behind the decks; stereo stacks play their side; a room without decks has no PA", () => {
  const sp = paSpeakers(DESERT_GATHERING), dj = DESERT_GATHERING.spots.find((s) => s.kind === "dj")!;
  expect(sp.map((s) => s.side)).toEqual(["mono", "mono", "mono", "mono"]);
  // one point source: shoulder to shoulder, under 5 m end to end, all behind the DJ
  const xs = sp.map((s) => s.at[0]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(5);
  expect(sp.every((s) => s.at[1] < dj.at[1])).toBe(true);
  // the same rig in stereo: the left pair plays the left of the set, and on the floor it's on your left
  const stereo = paSpeakers({ ...DESERT_GATHERING, outdoor: { ...DESERT_GATHERING.outdoor!, mono: false } });
  expect(stereo.map((s) => s.side)).toEqual([0, 0, 1, 1]);
  expect(hearSpeaker(stereo[0], { x: 0, z: 4, yaw: 0 }).pan).toBeLessThan(0);
  expect(paSpeakers(LIVE_ROOM)).toEqual([]);
});

test("each open-air rig stands shoulder to shoulder, and a narrow horn rig dulls sooner off its axis than a wide one", () => {
  const rig = (id: SystemId) => paSpeakers({ ...DESERT_GATHERING, outdoor: { ...DESERT_GATHERING.outdoor!, rig: id } });
  for (const id of SYSTEM_IDS) {
    const sp = rig(id), gap = Math.min(...sp.slice(1).map((s, i) => Math.hypot(s.at[0] - sp[i]!.at[0], s.at[1] - sp[i]!.at[1])));
    expect(gap, id).toBeGreaterThanOrEqual(stackWidth(SYSTEMS[id]));
    expect(gap, id).toBeLessThan(stackWidth(SYSTEMS[id]) + 0.1);
  }
  // 10 m out and 30 degrees off the middle stack's axis, against straight in front of it
  const [narrow, wide] = (["tri-amp", "synergy"] as const).map((id) => rig(id)[1]!);
  const off = (s: Speaker) => hearSpeaker(s, { x: s.at[0] + 10 * Math.sin(Math.PI / 6), z: s.at[1] + 10 * Math.cos(Math.PI / 6), yaw: 0 }).cutoff;
  const on = (s: Speaker) => hearSpeaker(s, { x: s.at[0], z: s.at[1] + 10, yaw: 0 }).cutoff;
  expect(off(narrow)).toBeLessThan(off(wide));
  expect(on(narrow)).toBe(on(wide));
  // 10 m behind a horn stack, facing it: the pattern takes the highs off it
  const st = rig("dance-stack")[1]!;
  expect(hearSpeaker(st, { x: st.at[0], z: st.at[1] - 10, yaw: Math.PI }).cutoff).toBe(800);
});
