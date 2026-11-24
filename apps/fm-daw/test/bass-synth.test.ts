// The jam room's bass seat: a mono synth you play like keys. Its notes press and light its own keys, a seated player's
// hands go on them, and the groove's bass track is a gliding mono ladder bass.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { randomAvatar } from "@rustybuns/util/avatar";
import { mulberry32 } from "@rustybuns/util";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";
import { DESERT_GATHERING } from "../src/studio/rooms/desert-gathering.ts";
import { bassReach, bassSynth } from "../src/studio/gear-models.ts";
import { monoSteal, withMonoBass } from "../src/studio/mono-bass.ts";
import { figure, handsOn } from "../src/studio/figure.ts";
import { LIT, lowC } from "../src/studio/played.ts";
import { demoProject } from "../src/presets.ts";
import { trackFor } from "../src/studio/jam.ts";
import { P } from "../src/engine/params.ts";

const bass = LIVE_ROOM.spots.find((s) => s.kind === "bass")!;

test("the bass seat builds the mono synth, its notes press its keys, and the player's hands are on them", () => {
  const { synth, keys } = bassSynth(bass);
  expect(synth.group.name).toBe("monosynth");
  expect([37, 44]).toContain(synth.count);
  // the groove's bass line on its track: each note it plays goes down and lights on this keyboard
  const p = withMonoBass(demoProject()), tr = trackFor(bass, p), low = lowC(p.tracks[tr].root);
  keys.press([45], low);
  expect(keys.down.whites.length + keys.down.blacks.length).toBe(1);
  const c = new THREE.Color();
  synth.keys.white.getColorAt(keys.down.whites[0], c);
  expect(c.getHex()).toBe(LIT.getHex());
  keys.press([], low);
  expect(keys.down).toEqual({ whites: [], blacks: [] });
  // seated there, the hands are on the keys before a note sounds, palms over them
  expect(handsOn("bass", false)).toBe("keys");
  const reach = bassReach(bass)!, fig = figure(randomAvatar(mulberry32(3)), null);
  fig.pose({ speed: 0, seated: true, play: "keys", note: false, t: 1, reach });
  fig.group.updateMatrixWorld(true);
  fig.group.traverse((o) => {
    if (o.name !== "hand") return;
    const at = fig.group.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    expect(Math.abs(-at.z - reach.ahead)).toBeLessThan(0.05);
    expect(Math.abs(at.y - reach.up)).toBeLessThan(0.05);
  });
  fig.dispose();
});

test("the bass track is a mono ladder bass with glide: a new note takes over the one held on that track", () => {
  const p = withMonoBass(demoProject()), t = p.tracks[trackFor(bass, p)].params;
  expect([t[P.MODE], t[P.FILTER]]).toEqual([1, 1]);
  expect(t[P.GLIDE]).toBeGreaterThan(0);
  // the rest of the groove is as it was
  expect(p.tracks.filter((x, i) => i !== trackFor(bass, p)).map((x) => x.params)).toEqual(demoProject().tracks.filter((_, i) => i !== trackFor(bass, p)).map((x) => x.params));
  const holding = new Map([["kb:KeyA", { track: 5 }], ["kb:KeyS", { track: 6 }]]);
  expect(monoSteal(holding, 5)).toEqual(["kb:KeyA"]);
});

test("out in the desert the bass seat is the bass-line box: a note lights its button, the hands are on them, the track squelches", () => {
  const seat = DESERT_GATHERING.spots.find((s) => s.kind === "bass")!, kind = DESERT_GATHERING.bass!;
  const { synth, keys } = bassSynth(seat, kind);
  expect(synth.group.name).toBe("bassbox");
  expect(synth.count).toBe(13);
  // any note folds into its one octave: an A two octaves up still lights the A
  const p = withMonoBass(demoProject(), kind), tr = trackFor(seat, p), low = lowC(p.tracks[tr].root);
  keys.press([low + 9 + 24], low);
  expect(keys.down).toEqual({ whites: [5], blacks: [] });
  const c = new THREE.Color();
  synth.keys.white.getColorAt(5, c);
  expect(c.getHex()).toBe(LIT.getHex());
  const reach = bassReach(seat, kind)!, fig = figure(randomAvatar(mulberry32(4)), null);
  fig.pose({ speed: 0, seated: true, play: "keys", note: false, t: 1, reach });
  fig.group.updateMatrixWorld(true);
  fig.group.traverse((o) => {
    if (o.name !== "hand") return;
    const at = fig.group.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    expect(Math.abs(-at.z - reach.ahead)).toBeLessThan(0.05);
  });
  fig.dispose();
  // the diode ladder, the resonance up, a slide
  const t = p.tracks[tr].params;
  expect([t[P.MODE], t[P.FILTER]]).toEqual([1, 3]);
  expect(t[P.RES]).toBeGreaterThan(0.6);
  expect(t[P.GLIDE]).toBeGreaterThan(0);
});
