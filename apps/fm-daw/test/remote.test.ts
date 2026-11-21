// The remote (/remote.html): a phone in the same sesh as the desk and the jam room. Its knobs follow the person's seat
// in the jam room, its edits land on the desk only with a Mix grant, and the transport only with Play.
import { expect, test } from "bun:test";
import { heard, setup, useWorld, type Sock } from "./world-kit.ts";
import { demoProject } from "../src/presets.ts";
import { apply, roomGain, type Project } from "../src/project.ts";
import { P } from "../src/engine/params.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";
import { decodeGrantServer, type GrantServer } from "../src/grants.ts";
import { levelOp, masterOp, muteOp, myTrack, rights, spaceOp, tone, toneOp, transport } from "../src/remote/remote.ts";

useWorld();
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test("the remote follows your seat, mixes the room once the leader lets it, and starts the groove only with Play", async () => {
  const { world, join } = await setup({}, "quiet-amber-lynx");
  const said = (ws: Sock, m: object) => world.webSocketMessage(ws, JSON.stringify(m));
  // the leader at the desk; Amy in the jam room on her laptop and with the remote on her phone, signed in as the same person
  const desk = (await join({}, "a".repeat(32))).ws, jam = (await join({}, "b".repeat(32))).ws, phone = (await join({}, "c".repeat(32))).ws;
  const ids: string[] = [];
  for (const [ws, key] of [[desk, "a"], [jam, "b"], [phone, "b"]] as const) {
    said(ws, { t: "hello", key: key.repeat(48), name: "" });
    ids.push((await heard(ws, "chat")).you);
  }
  const [leadId, amyId] = ids;
  expect(ids[2]).toBe(amyId);
  said(desk, { t: "init", project: demoProject() });

  // what the phone knows: the grants, and each peer's seat off the live line
  const grantsOf = (): GrantServer => decodeGrantServer(phone.sent.findLast((m) => m.t === "grants"))!;
  const seats = () => new Map<number, string | null>(phone.sent.filter((m) => m.t === "live" && m.e.t === "body").map((m) => [m.from, m.e.seat ?? null]));
  const mine = () => myTrack(seats(), grantsOf().peers, amyId, [LIVE_ROOM], deskProject);
  let deskProject: Project = demoProject();
  const deskHears = () => { for (const m of desk.sent.splice(0)) if (m.t === "op") deskProject = apply(deskProject, m.op); };

  // nobody sat yet: nothing is hers; she sits at the keys and they come up on the phone
  expect(mine()).toBeNull();
  said(jam, { t: "live", e: { t: "body", at: [2.6, 0, 0.7], yaw: 0, seat: "keys" } });
  const keys = deskProject.tracks.findIndex((t) => t.name === "Keys");
  expect(mine()).toBe(keys);

  // the leader holds the floor: the phone says it may not mix or play, and its faders don't reach the desk
  said(desk, { t: "floor", state: "held" });
  await settle();
  expect(rights(grantsOf(), "held", amyId)).toEqual({ mix: false, play: false });
  desk.sent = [];
  said(phone, { t: "op", op: levelOp(keys, 0.2) });
  deskHears();
  expect(deskProject.tracks[keys].params[P.GAIN]).not.toBe(0.2);

  // granted Mix: the fader, tone, space, mute and the room's level all land; play stays the leader's
  said(desk, { t: "grant", who: amyId, can: ["mix"] });
  await settle();
  expect(rights(grantsOf(), "held", amyId)).toEqual({ mix: true, play: false });
  desk.sent = [];
  for (const op of [levelOp(keys, 0.2), toneOp(keys, 0.3), spaceOp(keys, 0.6), muteOp(0, true), masterOp(-12)]) said(phone, { t: "op", op });
  said(phone, { t: "live", e: transport(true) });
  const heardLive = desk.sent.some((m) => m.t === "live");
  deskHears();
  const k = deskProject.tracks[keys];
  expect([k.params[P.GAIN], tone(k), k.params[P.SEND], deskProject.tracks[0].mute]).toEqual([0.2, expect.closeTo(0.3, 5), 0.6, true]);
  expect(roomGain(deskProject)).toBeCloseTo(10 ** (-12 / 20), 5);
  expect(heardLive).toBe(false);

  // granted Play too: the phone starts the groove everywhere; then she moves to the kit, and the knobs go with her
  said(desk, { t: "grant", who: amyId, can: ["mix", "play"] });
  await settle();
  desk.sent = [];
  said(phone, { t: "live", e: transport(true) });
  expect(desk.sent).toContainEqual({ t: "live", from: expect.any(Number), e: { t: "play" } });
  said(jam, { t: "live", e: { t: "body", at: [-0.6, 0, 0.4], yaw: 0, seat: "drums" } });
  expect(mine()).toBe(deskProject.tracks.findIndex((t) => t.kind === "drum"));
  expect(leadId).not.toBe(amyId);
});

test("the room's level: all the way down is silence, back up to 0 dB reads as a groove nobody turned down", () => {
  let p = apply(demoProject(), masterOp(-60));
  expect(roomGain(p)).toBe(0);
  p = apply(p, masterOp(0));
  expect(p.master).toBeUndefined();                                  // a groove at unity reads as before the field
  expect(roomGain(p)).toBe(1);
});
