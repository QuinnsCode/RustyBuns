// The jam room's see-through keys and wheels: each computer key shows the note it plays where you sit (the octave
// shift included), the pitch wheel bends and springs back, the mod wheel adds vibrato, and the bend they make is a live
// event the World passes on that moves the pitch of what sounds.
import { expect, test } from "bun:test";
import { demoProject } from "../src/presets.ts";
import { decodeClient } from "../src/project.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { TRACKS } from "../src/engine/params.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";
import { newJam, sit, trackFor } from "../src/studio/jam.ts";
import { VIBRATO, WHEEL_SEMIS, Wheels, bendEvent, keyMap } from "../src/studio/overlay.ts";

test("seated at the keys, each computer key shows its note, an octave up after X; at the kit or standing, none", () => {
  const p = demoProject(), j = newJam(LIVE_ROOM);
  expect(keyMap(j, p, 0)).toBeNull();
  const sitAt = (id: string) => { const sp = LIVE_ROOM.spots.find((x) => x.id === id)!; j.me.x = sp.at[0]; j.me.z = sp.at[1]; expect(sit(j, id).ok).toBe(true); };
  sitAt("keys");
  const at = (octave: number) => Object.fromEntries(keyMap(j, p, octave)!.caps.map((c) => [c.key, [c.note, c.black]]));
  const root = p.tracks[trackFor(LIVE_ROOM.spots.find((s) => s.id === "keys")!, p)].root;
  expect(root).toBe(60);
  expect([at(0).A, at(0).W, at(0).K, at(1).A, at(-1)["'"]]).toEqual([["C4", false], ["C#4", true], ["C5", false], ["C5", false], ["F4", false]]);
  sitAt("drums");
  expect(keyMap(j, p, 0)).toBeNull();
});

test("the pitch wheel bends while held and springs back; the mod wheel wobbles it; each move goes once", () => {
  const w = new Wheels();
  let t = 0;
  const run = (s: number) => { let semis = 0; for (let i = 0; i < s * 60; i++) semis = w.tick(1 / 60, (t += 1 / 60)); return semis; };
  w.push(1);
  expect(run(0.5)).toBe(WHEEL_SEMIS);
  w.push(0);
  expect(run(1)).toBe(0);
  w.push(-1);
  expect(run(0.5)).toBe(-WHEEL_SEMIS);
  w.push(0); run(1);
  w.mod = 1;
  const wobble = Array.from({ length: 30 }, () => run(1 / 60));
  expect(Math.max(...wobble)).toBeGreaterThan(VIBRATO * 0.8);
  expect(Math.min(...wobble)).toBeLessThan(-VIBRATO * 0.8);
  w.mod = 0;
  expect([w.changed(0.5), w.changed(0.505), w.changed(0), w.changed(0)]).toEqual([0.5, null, 0, null]);
});

test("a bend from the wheel is a live event the World passes on, and it raises the pitch of the note that sounds", () => {
  const p = demoProject(), track = trackFor(LIVE_ROOM.spots.find((s) => s.id === "keys")!, p);
  expect(decodeClient({ t: "live", e: bendEvent(track, WHEEL_SEMIS) })).toEqual({ t: "live", e: { t: "bend", track, semis: WHEEL_SEMIS } });
  // the note's pitch, by how often the sound crosses zero, before and after the bend
  const SR = 48000, e = new TsEngine(SR);
  e.setMaster(1);
  for (let t = 0; t < TRACKS; t++) p.tracks[t].params.forEach((v, i) => e.setParam(t, i, v));
  e.noteOn(track, 1, 60, 1);
  const crossings = () => {
    const out = new Float32Array(SR * 2 * 0.25);
    e.render(out, SR * 0.25);
    let n = 0;
    for (let i = 2; i < out.length; i += 2) if ((out[i - 2] < 0) !== (out[i] < 0)) n++;
    return n;
  };
  crossings();
  const flat = crossings();
  e.setBend(track, WHEEL_SEMIS);
  crossings();
  expect(crossings() / flat).toBeCloseTo(2 ** (WHEEL_SEMIS / 12), 1);
});
