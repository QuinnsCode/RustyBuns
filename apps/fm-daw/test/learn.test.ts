import { test, expect } from "bun:test";
import { arm, ccValue, learnState, onCc, setLearning } from "../src/ui/learn.ts";
import { P, RANGES } from "../src/engine/params.ts";

test("MIDI learn: touch a slider, move a knob, and that knob drives it; the old pairing for that CC goes", () => {
  expect(onCc(74, 1)).toEqual({ i: P.CUTOFF, v: 1 }); // out of the box
  setLearning(true);
  arm(P.FOLD, false, "Fold");
  expect(onCc(74, 0.2)).toBeNull(); // learned, not played
  setLearning(false);
  expect(onCc(74, 0.5)).toEqual({ i: P.FOLD, v: 0.5 });
  expect(learnState().map.filter((m) => m.cc === 74)).toHaveLength(1);
  expect(onCc(21, 0.5)).toBeNull(); // unmapped
});

test("a log slider's knob follows the slider's travel", () => {
  const [lo, hi] = RANGES[P.attack(0)];
  expect(ccValue({ cc: 1, i: P.attack(0), log: true }, 0.5)).toBeCloseTo(Math.sqrt(lo * hi));
  expect(ccValue({ cc: 1, i: P.attack(0), log: true }, 0)).toBe(lo);
});
