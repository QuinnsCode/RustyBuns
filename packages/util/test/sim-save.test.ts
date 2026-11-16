import { expect, test } from "bun:test";
import { firstDiff, loadSim, roundTrip, saveSim } from "../src/lab/sim-save.ts";

test("a save keeps what plain JSON loses, and the diff names where two states part", () => {
  const s = { never: Infinity, floor: -Infinity, nan: NaN, z: -0, list: [1, "two", null], deep: { at: 3 } };
  const back = loadSim(saveSim(s));
  expect(firstDiff(s, back)).toBeNull();
  expect(Object.is(back.z, -0)).toBe(true);
  expect(firstDiff(s, { ...s, deep: { at: 4 } })).toBe("$.deep.at: 3 vs 4");
  expect(firstDiff(s, { ...s, list: [1] })).toBe("$.list.length: 3 vs 1");
});

test("a sim that keeps state outside what it saves fails the round trip, and says where", () => {
  let hidden = 0; // a module-level counter the save never sees
  const sim = { start: () => ({ n: 0 }), step: (s: { n: number }, add: number) => { s.n += add + (hidden++ % 3 === 0 ? 1 : 0); } };
  expect(roundTrip({ start: () => ({ n: 0 }), step: (s, add: number) => { s.n += add; } }, (f) => f, 5, 20).diff).toBeNull();
  expect(roundTrip(sim, (f) => f, 5, 20).diff).toMatch(/^\$\.n: /);
});
