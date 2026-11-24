// The keys seat sounds like what stands there (src/studio/keys-voice.ts): the room's keys track takes its family's voice.
import { expect, test } from "bun:test";
import { POLY_KINDS } from "@rustybuns/models/polysynth";
import { demoProject } from "../src/presets.ts";
import { keysKind } from "../src/studio/gear-models.ts";
import { KEYS_VOICES, withKeysVoice } from "../src/studio/keys-voice.ts";
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
