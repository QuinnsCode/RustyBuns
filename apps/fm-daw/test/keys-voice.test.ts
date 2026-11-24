// The keys seat sounds like what stands there (src/studio/keys-voice.ts): the room's keys track takes its family's voice.
import { expect, test } from "bun:test";
import { POLY_KINDS } from "@rustybuns/models/polysynth";
import { demoProject } from "../src/presets.ts";
import { keysKind } from "../src/studio/gear-models.ts";
import { KEYS_VOICES, withKeysVoice } from "../src/studio/keys-voice.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";
import { BARN, SCORING_HALL } from "../src/studio/rooms/index.ts";

test("the keys track plays the voice of the instrument at the room's keys seat, and only that track changes", () => {
  const spot = LIVE_ROOM.spots.find((s) => s.kind === "keys")!, before = demoProject();
  const keysAt = before.tracks.findIndex((t) => t.name.toLowerCase().includes("keys"));
  for (const kind of [keysKind(spot), ...POLY_KINDS]) {
    const after = withKeysVoice(before, kind);
    expect(after.tracks[keysAt]!.params).toEqual(KEYS_VOICES[kind]);
    expect(after.tracks.filter((_, i) => i !== keysAt)).toEqual(before.tracks.filter((_, i) => i !== keysAt));
  }
  // a room with no keys seat keeps the groove as it is
  expect(withKeysVoice(before, null)).toBe(before);
  // no two families share a voice
  expect(new Set(POLY_KINDS.map((k) => KEYS_VOICES[k].join())).size).toBe(POLY_KINDS.length);
});

test("a room's keys seat is its own family, and a seat named for a section is that section's instrument", () => {
  const at = (def: { spots: { id: string }[] }, id: string) => def.spots.find((s) => s.id === id)! as Parameters<typeof keysKind>[0];
  expect(keysKind(at(LIVE_ROOM, "keys"), undefined, LIVE_ROOM.keys)).toBe("wood-poly");
  expect(keysKind(at(BARN, "keys"), undefined, BARN.keys)).toBe("drawbar");
  expect(keysKind(at(SCORING_HALL, "piano"), undefined, SCORING_HALL.keys)).toBe("tine-ep");
  expect(keysKind(at(SCORING_HALL, "violins"), undefined, SCORING_HALL.keys)).toBe("strings");
  expect(keysKind(at(SCORING_HALL, "brass"), undefined, SCORING_HALL.keys)).toBe("wood-poly");
  // and ?keys= over all of it
  expect(keysKind(at(BARN, "keys"), "combo", BARN.keys)).toBe("combo");
});

test("the drawbar organ turns its rotary speaker: each side swells and fades, out of step with the other", () => {
  const SR = 48000, e = new TsEngine(SR);
  KEYS_VOICES.drawbar.forEach((v, i) => e.setParam(0, i, v));
  e.setMaster(1);
  for (const m of [60, 64, 67]) e.noteOn(0, m, m, 0.8);
  const n = SR * 3, out = new Float32Array(n * 2);
  for (let at = 0; at < n; at += 128) { const b = new Float32Array(256); e.render(b, 128); out.set(b, at * 2); }
  // each side's loudness in 50 ms windows over the last two seconds: a turn and a half of the horn
  const w = SR / 20, side = (c: 0 | 1) => { const lv: number[] = []; for (let i = SR; i + w <= n; i += w) { let s = 0; for (let k = 0; k < w; k++) s += out[2 * (i + k) + c]! ** 2; lv.push(10 * Math.log10(s / w)); } return lv; };
  const L = side(0), R = side(1), swing = (x: number[]) => Math.max(...x) - Math.min(...x);
  expect(swing(L)).toBeGreaterThan(3);
  // a quarter turn apart: the two sides aren't loud at the same moments
  const loudL = L.indexOf(Math.max(...L)), loudR = R.indexOf(Math.max(...R));
  expect(loudL).not.toBe(loudR);
});
