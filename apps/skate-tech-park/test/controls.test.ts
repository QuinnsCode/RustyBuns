// Control settings: what a player's saved settings turn into, including a save that has gone wrong.
import { expect, test } from "bun:test";
import { DEFAULT_CONTROLS, parseControls, tuned } from "../src/controls.ts";
import { matchStroke } from "../src/flick.ts";
import { PROFILES } from "../src/flick-profiles.ts";

test("settings read back as saved; nothing, junk and out-of-range values fall back to the defaults", () => {
  const mine = { ...DEFAULT_CONTROLS, swap: true, invertY: true, size: 1.2, labels: "never" as const, sens: 1.5 };
  expect(parseControls(JSON.stringify(mine))).toEqual(mine);
  expect(parseControls(null)).toEqual(DEFAULT_CONTROLS);
  expect(parseControls("{nope")).toEqual(DEFAULT_CONTROLS);
  expect(parseControls(JSON.stringify({ ...mine, size: 99, labels: "sometimes", swap: "yes" }))).toEqual({ ...mine, size: 1, labels: "first", swap: false });
});

test("left-handed puts the pad on the left, and a higher sensitivity makes a shorter drag count", () => {
  const classic = PROFILES[0];
  expect(tuned(classic, { ...DEFAULT_CONTROLS, swap: true }).side).toBe("left");
  expect(matchStroke(classic, "mid", 20, 0, 0.1)).toBeNull();
  expect(matchStroke(tuned(classic, { ...DEFAULT_CONTROLS, sens: 2 }), "mid", 20, 0, 0.1)?.flick).toBe("kickflip");
});
