// The field a sound crosses (field.ts) against the standards' own tables.
import { expect, test } from "bun:test";
import { airAbsorption, groundLoss, pressureAt } from "../src/index.ts";

test("air loss over 100 m at 1, 4 and 8 kHz matches ISO 9613-1's table, cool dry air against damp", () => {
  // dB over 100 m: ISO 9613-1:1993 Table 1 (g) and (h), dB/km / 10; ISO 9613-2:1996 Table 2 for 10 C, 70 %.
  const rows: [tempC: number, rh: number, hz: number, db100m: number][] = [
    [10, 30, 1000, 0.677], [10, 30, 4000, 7.66], [10, 30, 8000, 18.7],
    [15, 80, 1000, 0.415], [15, 80, 4000, 2.37], [15, 80, 8000, 8.28],
    [10, 70, 1000, 0.37], [10, 70, 4000, 3.28], [10, 70, 8000, 11.7],
  ];
  for (const [t, rh, hz, want] of rows) expect(Math.abs((airAbsorption(hz, t, rh) * 100) / want - 1)).toBeLessThan(0.06);
  // a hot damp night carries the top octaves much further than a cool dry one
  expect(airAbsorption(8000, 30, 80) * 100).toBeLessThan(airAbsorption(8000, 10, 30) * 100 / 3);
  // and the dry evening at 1,950 m takes more than twice what damp sea-level air does
  expect(airAbsorption(8000, 17, 22, pressureAt(1950)) * 100).toBeGreaterThan(20);
});

test("ground: hard ground hands back 3 dB, grass leaves the top octaves alone and dips the mids near the ground", () => {
  // ISO 9613-2 table 3, 50 m out, horn 2 m up, ears 1.6 m: G = 0 is -1.5 per region, G = 1 nothing above 2 kHz
  expect(groundLoss(0, 2, 1.6, 50, 4000)).toBeCloseTo(-3, 5);
  expect(groundLoss(1, 2, 1.6, 50, 4000)).toBeCloseTo(0, 5);
  expect(groundLoss(1, 2, 1.6, 50, 500)).toBeGreaterThan(groundLoss(1, 2, 1.6, 50, 4000));
});
