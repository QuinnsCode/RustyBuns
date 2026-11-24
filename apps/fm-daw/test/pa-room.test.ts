// The PA heard from the floor (src/studio/pa-room.ts): level by the inverse square law, the speed of sound's delay,
// the air's highs, and a speaker behind you quieter; and Desert Gathering's stacks as the speakers it plays from: one mono point source.
import { expect, test } from "bun:test";
import { EAR_Y, HORN_Y, hearSpeaker, paSpeakers, SOUND_SPEED, stackBlocks, type Speaker } from "../src/studio/pa-room.ts";
import { clubStack, subCones } from "../src/studio/open-air.ts";
import { GEAR_SIZES } from "@rustybuns/models/gear";
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

test("Desert Gathering stands a side of two stacks each side of the floor, toed in, each playing its side of the set; the sub block sits between them; mono sums them; a room without decks has no PA", () => {
  const sp = paSpeakers(DESERT_GATHERING), dj = DESERT_GATHERING.spots.find((s) => s.kind === "dj")!;
  expect(stackBlocks(sp).map((b) => b.length)).toEqual([2, 2]);
  expect(sp.map((s) => s.side)).toEqual([0, 0, 1, 1]);
  // facing the stacks from the floor, the left side is on your left, and each side is aimed in across the floor
  expect(hearSpeaker(sp[0]!, { x: 0, z: 4, yaw: 0 }).pan).toBeLessThan(0);
  for (const s of sp) expect(Math.sin(s.yaw) * s.at[0]).toBeLessThan(0);
  expect(sp.every((s) => s.at[1] < dj.at[1])).toBe(true);
  const subs = DESERT_GATHERING.outdoor!.subs!;
  expect(subs.at[0]).toBeGreaterThan(Math.max(...sp.filter((s) => s.at[0] < 0).map((s) => s.at[0])));
  expect(subs.at[0]).toBeLessThan(Math.min(...sp.filter((s) => s.at[0] > 0).map((s) => s.at[0])));
  const mono = paSpeakers({ ...DESERT_GATHERING, outdoor: { ...DESERT_GATHERING.outdoor!, mono: true } });
  expect(mono.map((s) => s.side)).toEqual(["mono", "mono", "mono", "mono"]);
  expect(paSpeakers(LIVE_ROOM)).toEqual([]);
});

test("each open-air rig stands shoulder to shoulder, and a narrow horn rig dulls sooner off its axis than a wide one", () => {
  const rig = (id: SystemId) => paSpeakers({ ...DESERT_GATHERING, outdoor: { ...DESERT_GATHERING.outdoor!, rig: id } });
  for (const id of SYSTEM_IDS) {
    const sp = rig(id), gap = Math.min(...sp.slice(1).map((s, i) => Math.hypot(s.at[0] - sp[i]!.at[0], s.at[1] - sp[i]!.at[1])));
    expect(gap, id).toBeGreaterThanOrEqual(stackWidth(SYSTEMS[id]));
    expect(gap, id).toBeLessThan(stackWidth(SYSTEMS[id]) + 0.1);
  }
  // 10 m out and 30 degrees off a stack's own axis (the sides are toed in), against straight in front of it
  const [narrow, wide] = (["tri-amp", "synergy"] as const).map((id) => rig(id)[1]!);
  const out = (s: Speaker, a: number) => hearSpeaker(s, { x: s.at[0] + 10 * Math.sin(s.yaw + a), z: s.at[1] + 10 * Math.cos(s.yaw + a), yaw: 0 }).cutoff;
  const off = (s: Speaker) => out(s, Math.PI / 6), on = (s: Speaker) => out(s, 0);
  expect(off(narrow)).toBeLessThan(off(wide));
  expect(on(narrow)).toBe(on(wide));
  // 10 m behind a horn stack, facing it: the pattern takes the highs off it
  const st = rig("dance-stack")[1]!;
  expect(hearSpeaker(st, { x: st.at[0], z: st.at[1] - 10, yaw: Math.PI }).cutoff).toBe(800);
});

test("a club stack's sub pumps on the beat, settles between beats, rests when the band stops, and never pokes through its grille", () => {
  const st = clubStack([0, 0], 0), pump = subCones([st]), cone = st.getObjectByName("part:cone")!, rest = cone.position.z;
  const front = GEAR_SIZES["sub-18"][2] / 2 - 0.014; // the grille's back face
  pump(8);
  expect(cone.position.z - rest).toBeCloseTo(st.getObjectByName("sub-18")!.userData.coneThrow, 6);
  expect(cone.position.z).toBeLessThan(front);
  pump(8.5);
  expect(cone.position.z - rest).toBeLessThan(0.0001);
  pump(null);
  expect(cone.position.z).toBe(rest);
});
