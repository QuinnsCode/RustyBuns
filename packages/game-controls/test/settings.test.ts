import { expect, test } from "bun:test";
import { DEFAULTS, parseSettings } from "../src/index.ts";

test.each([
  [null, DEFAULTS],
  ["junk", DEFAULTS],
  [{ lookX: 2, lookY: 0.5, touch: 1.5, invertY: true }, { lookX: 2, lookY: 0.5, touch: 1.5, invertY: true }],
  [{ lookX: 99, lookY: -4, touch: "fast", invertY: "yes" }, { lookX: 3, lookY: 0.25, touch: 1, invertY: false }],
])("parseSettings(%j)", (raw, want) => expect(parseSettings(raw)).toEqual(want));
