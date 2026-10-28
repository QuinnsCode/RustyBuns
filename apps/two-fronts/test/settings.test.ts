import { DEFAULTS } from "@rustybuns/game-controls";
import { expect, test } from "bun:test";
import { RESERVED, lookTurn, parseSettings, rebind, resetSettings, setLook, settings } from "../src/settings.ts";

// The browser's storage, as a map.
const store = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });

// A player flips invert Y and slows the mouse in the cog: the look runs the other way and slower.
test("the cog's invert Y and look speeds change how a drag turns the view", () => {
  setLook({ ...DEFAULTS });
  const up = lookTurn(0, -10, "mouse").pitch; // the mouse moved up: look up
  expect(up).toBeGreaterThan(0);
  setLook({ ...DEFAULTS, invertY: true });
  expect(lookTurn(0, -10, "mouse").pitch).toBe(-up);
  expect(lookTurn(10, 0, "mouse").yaw).toBeLessThan(0); // left/right unchanged
  expect(lookTurn(0, -10, "touch").pitch).toBeLessThan(0);

  setLook({ ...DEFAULTS, lookY: 2, touch: 0.5 });
  expect(lookTurn(0, -10, "mouse").pitch).toBe(2 * up);
  expect(lookTurn(0, -10, "touch").pitch).toBeCloseTo(0.5 * 0.006 * 10);
  setLook({ ...DEFAULTS });
});

test("rebinding a key moves the action, and a key already in use or kept by the game is refused", () => {
  resetSettings();
  expect(rebind("strike", "z")).toBeNull();
  expect(settings.keys.strike).toBe("z");
  expect(rebind("use", "w")).toEqual({ clash: "forward" });
  expect(settings.keys.use).toBe("e");
  expect(rebind("use", "1")).toEqual({ reserved: true });
  resetSettings();
});

test.each([
  ["nothing saved", null], ["not JSON", "{oops"], ["the wrong shape", "[1,2]"],
  ["wrong field types", JSON.stringify({ invertY: "yes", mouse: 99, fov: "wide", keys: "wasd" })],
  ["two actions on one key", JSON.stringify({ keys: { strike: "w" } })],
  ["a reserved key", JSON.stringify({ keys: { strike: RESERVED[0] } })],
])("a damaged save (%s) falls back to the defaults", (_, text) => {
  expect(parseSettings(text)).toEqual(parseSettings(null));
});
