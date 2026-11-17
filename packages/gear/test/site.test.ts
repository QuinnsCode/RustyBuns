// The festival's site physics against numbers worked by hand.
import { expect, test } from "bun:test";
import { AMPACITY, MAX_DROP, airLoss, feederDrop, imbalance, leq, levelAt, neutralAmps, ohmsPerMetre, runningLeq, subBlock, sumPower, worstLeq } from "../src/index.ts";

test.each([
  // hz, metres, dB: ISO 9613-1 at 20 C, 70% RH; 2 kHz over the 120 m between two stages is about a decibel
  [1000, 1000, 3.7],
  [2000, 120, 1.164],
  [63, 1000, 0.1],
  [1414, 1000, 6.7],
])("air takes %d Hz down over %d m by %d dB", (hz, m, db) => expect(airLoss(hz, m)).toBeCloseTo(db, 1));

test.each([
  // phase amps, neutral amps (phasor sum, 120 degrees apart), imbalance
  [[40, 40, 40], 0, 0],
  [[60, 30, 10], Math.sqrt(1900), 0.8],
  [[50, 0, 0], 50, 2],
] as const)("phases %j put %d A on the neutral", (p, n, k) => {
  expect(neutralAmps(p)).toBeCloseTo(n, 2);
  expect(imbalance(p)).toBeCloseTo(k, 2);
});

test.each([
  // awg, metres, phases, drop: R = ohms/m x L; drop = (I max + I neutral) R / 120 V
  [6, 80, [40, 40, 40], (40 * ohmsPerMetre(6) * 80) / 120, true],
  [6, 80, [60, 30, 10], ((60 + Math.sqrt(1900)) * ohmsPerMetre(6) * 80) / 120, false],
  [-1, 80, [60, 30, 10], ((60 + Math.sqrt(1900)) * ohmsPerMetre(-1) * 80) / 120, true],
] as const)("%d AWG over %d m at %j drops what Ohm's law says", (awg, m, p, drop, ok) => {
  expect(feederDrop(awg, m, p)).toBeCloseTo(drop, 5);
  expect(feederDrop(awg, m, p) <= MAX_DROP).toBe(ok);
});

test("6 AWG is 1.3 milliohm a metre and carries 55 A; 2/0 carries 195", () => {
  expect(ohmsPerMetre(6) * 1000).toBeCloseTo(1.3, 1);
  expect(AMPACITY[6]).toBe(55);
  expect(AMPACITY[-1]).toBe(195);
});

test.each([
  // stretches, LAeq: half a quarter hour at 101 and half at 93 averages 98.6 (the loud song paid back)
  [[{ seconds: 450, db: 101 }, { seconds: 450, db: 93 }], 98.63],
  [[{ seconds: 900, db: 98 }], 98],
  [[{ seconds: 600, db: 100 }, { seconds: 300, db: -Infinity }], 100 - 10 * Math.log10(1.5)],
])("LAeq of %j is %d", (s, db) => expect(leq(s)).toBeCloseTo(db, 2));

test("the running 15-minute average forgets what is older, and counts silence before the show", () => {
  expect(runningLeq([{ seconds: 300, db: 100 }])).toBeCloseTo(100 - 10 * Math.log10(3), 2);
  const log = [{ seconds: 900, db: 104 }, { seconds: 900, db: 96 }];
  expect(runningLeq(log)).toBeCloseTo(96, 5);
  expect(worstLeq(log)).toBeCloseTo(104, 5);
});

test.each(["horn-sub-21", "arc-sub-18"])("a cardioid block of three %s takes 10 dB or more off the back for 4 dB or less in front (one box of three no longer faces forward)", (id) => {
  const at = { x: 0, y: 0.4, z: 0 }, omni = subBlock(id, at, 0, "omni"), card = subBlock(id, at, 0, "cardioid");
  const ring = (deg: number) => ({ x: 60 * Math.sin((deg * Math.PI) / 180), y: 1.6, z: 60 * Math.cos((deg * Math.PI) / 180) });
  const rear = [135, 150, 165, 180, 195, 210, 225].map(ring), front = ring(0);
  for (const hz of [50, 63, 80]) {
    const off = sumPower(rear.map((p) => levelAt(omni, p, "low", hz))) - sumPower(rear.map((p) => levelAt(card, p, "low", hz)));
    expect(off).toBeGreaterThan(10);
    expect(levelAt(omni, front, "low", hz) - levelAt(card, front, "low", hz)).toBeLessThan(4);
  }
});
