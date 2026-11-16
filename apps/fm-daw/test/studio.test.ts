// What the world says no to in the studio, so every friend's copy takes the same steps.
import { expect, test } from "bun:test";
import { applyStudio, decodeStudioClient, emptyStudio, type Studio, type StudioOp } from "../src/studio.ts";

const A = 1, B = 2;
function room(...steps: [number, StudioOp][]): Studio {
  return steps.reduce((s, [p, op]) => applyStudio(s, p, op), emptyStudio());
}
const set: [number, StudioOp][] = [
  [A, { t: "bring", id: "amp", gear: "q-amp", at: [0, 0, 0], turn: 0 }], [A, { t: "put", at: [0, 0, 0], turn: 0 }],
  [A, { t: "bring", id: "cab", gear: "cab-1x12", at: [1, 0, 0], turn: 0 }], [A, { t: "put", at: [1, 0, 0], turn: 0 }],
  [A, { t: "lead", from: ["amp", "speaker-out"] }], [A, { t: "plug", to: ["cab", "in"] }],
];

test.each<[string, [number, StudioOp][], number, StudioOp]>([
  ["a full hand can't pick up a second box", [[A, { t: "pick", id: "amp" }]], A, { t: "pick", id: "cab" }],
  ["a jack with a cable in it takes no other", [], B, { t: "lead", from: ["cab", "in"] }],
  ["a lead can't be plugged into a jack in use", [[B, { t: "lead", from: ["amp", "fx-out"] }]], B, { t: "plug", to: ["amp", "speaker-out"] }],
  ["a box someone carries can't be binned by another", [[A, { t: "pick", id: "cab" }]], B, { t: "bin", id: "cab" }],
  ["a box that isn't in the room can't be cabled", [], B, { t: "lead", from: ["ghost", "out"] }],
  ["putting down with an empty hand", [], B, { t: "put", at: [0, 0, 0], turn: 0 }],
])("%s", (_, before, who, op) => {
  const s = room(...set, ...before);
  expect(applyStudio(s, who, op)).toBe(s);
});

test("binning a box takes its cables and knobs with it, and a lead pulled out of it", () => {
  const s = room(...set, [A, { t: "knob", id: "cab", knob: "tone", v: 0.5 }], [B, { t: "lead", from: ["cab", "thru"] }], [A, { t: "bin", id: "cab" }]);
  expect(s).toEqual({ patch: { placed: [{ id: "amp", gear: "q-amp", at: [0, 0, 0], turn: 0 }], cables: [], knobs: {} }, held: {} });
});

test("an op of the wrong shape off the wire is no op", () => {
  for (const op of [{ t: "pick" }, { t: "knob", id: "amp", knob: "gain", v: 2 }, { t: "lead", from: ["amp"] }, { t: "bring", id: "Amp!", gear: "q", at: [0, 0, 0], turn: 0 }, { t: "fly" }])
    expect(decodeStudioClient({ t: "studio", op })).toBeNull();
  expect(decodeStudioClient({ t: "studio", op: { t: "drop" } })).toEqual({ t: "studio", op: { t: "drop" } });
});
