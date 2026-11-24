// The keys seat sounds like what stands there (src/studio/keys-voice.ts): the room's keys track takes its family's voice.
import { expect, test } from "bun:test";
import { POLY_KINDS } from "@rustybuns/models/polysynth";
import { demoProject } from "../src/presets.ts";
import { keysKind } from "../src/studio/gear-models.ts";
import { KEYS_VOICES, withKeysVoice } from "../src/studio/keys-voice.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";

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
