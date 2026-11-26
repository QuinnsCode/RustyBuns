// The field a sound crosses (field.ts) against the standards' own tables.
import { expect, test } from "bun:test";
import { airAbsorption, banks, groundLoss, groundMap, heightMap, highest, pressureAt } from "../src/index.ts";

test("a captured height map: bilinear between samples, flat outside it, placed as the capture is, the higher of it and a bank", () => {
  // a 3 by 2 raster, 2 m apart from (0, 0): a slope up x from 0 to 4 m
  const m = { x0: 0, z0: 0, cell: 2, cols: 3, h: [0, 2, 4, 0, 2, 4] };
  const land = heightMap(m);
  const rows: [x: number, z: number, want: number][] = [
    [0, 0, 0], [1, 1, 1], [4, 2, 4], [3, 0.5, 3], // inside, its far edges included
    [-0.01, 1, 0], [4.01, 1, 0], [2, -0.01, 0], [2, 2.01, 0], // just outside every edge: flat
  ];
  for (const [x, z, want] of rows) expect([x, z, land(x, z)]).toEqual([x, z, want]);
  // drawn half as big again, raised 1 m, turned a quarter (its +x now runs down -z): 3 m up its slope stands 5.5 m high
  const placed = heightMap(m, [10, 1, 0], Math.PI / 2, 1.5);
  expect(placed(11.5, -4.5)).toBeCloseTo(5.5, 9);
  expect(placed(16, 0)).toBe(0);
  // a 1 m bank on the low end wins there, the slope wins further up
  const both = highest(land, banks([{ at: [0.5, 1], yaw: Math.PI / 2, len: 2, h: 1 }]))!;
  expect(both(0.5, 1)).toBeCloseTo(1, 9);
  expect(both(3, 1)).toBe(3);
  expect(highest(undefined, undefined)).toBeUndefined();
});

test("groundMap reads the floor under a capture's points, not the furniture or the roof", () => {
  // a 10 m room whose floor rises 1 m to the far wall, a table 2 m up in its middle, a roof at 4 m
  const xyz: number[] = [];
  for (let x = 0; x <= 10; x += 0.25) for (let z = 0; z <= 10; z += 0.25) {
    xyz.push(x, z / 10, z, x, 4, z);
    if (Math.abs(x - 5) < 1 && Math.abs(z - 5) < 1) xyz.push(x, 2, z, x, 2, z);
  }
  const land = heightMap(groundMap(xyz)!);
  for (const [x, z] of [[1, 1], [5, 5], [9, 8], [3, 6]] as const) expect(Math.abs(land(x, z) - z / 10)).toBeLessThan(0.15);
  expect(groundMap([0, 0, 0])).toBeNull();
});

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
