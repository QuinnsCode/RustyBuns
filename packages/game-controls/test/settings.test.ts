import { expect, test } from "bun:test";
import { DEFAULTS, parseSettings, volumeOf } from "../src/index.ts";

test.each([
  [null, DEFAULTS],
  ["junk", DEFAULTS],
  [{ lookX: 2, lookY: 0.5, touch: 1.5, invertY: true }, { lookX: 2, lookY: 0.5, touch: 1.5, invertY: true }],
  [{ lookX: 99, lookY: -4, touch: "fast", invertY: "yes" }, { lookX: 3, lookY: 0.25, touch: 1, invertY: false }],
])("parseSettings(%j)", (raw, want) => expect(parseSettings(raw)).toMatchObject(want));

test("old saves keep working and new fields clamp", () => {
  const s = parseSettings({ lookX: 2, brightness: 9, music: -1, tilt: 40, muted: ["steps", 3], musicOn: false });
  expect(s).toMatchObject({ lookX: 2, brightness: 1.5, music: 0, tilt: 15, muted: ["steps"], musicOn: false, sfxOn: true, touchX: 1 });
});

test("volumeOf is silent when the group or the piece is off", () => {
  const s = { ...DEFAULTS, sfx: 0.5, muted: ["steps"] };
  expect([volumeOf(s, "sfx"), volumeOf(s, "sfx", "steps"), volumeOf({ ...s, musicOn: false }, "music")]).toEqual([0.5, 0, 0]);
});
