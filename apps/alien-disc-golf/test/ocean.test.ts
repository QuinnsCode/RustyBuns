import { expect, test } from "bun:test";
import { countries } from "../src/countries.ts";
import { unwrap } from "../src/ocean.ts";

const byName = (n: string) => countries().find((c) => c.name === n)!;
// The widest east-west step between neighbours, leaving out an edge along a pole (where all longitudes meet).
const maxJump = (ring: number[][]) => ring.slice(1).reduce((m, p, k) => Math.abs(p[1]!) === 90 && Math.abs(ring[k]![1]!) === 90 ? m : Math.max(m, Math.abs(p[0]! - ring[k]![0]!)), 0);

test("rings that cross the date line draw as one shape on the sea map", () => {
  for (const name of ["Russia", "Fiji", "Antarctica"]) {
    const rings = byName(name).outer;
    expect(Math.max(...rings.map(maxJump))).toBeGreaterThan(180); // the map cuts them at ±180
    for (const ring of rings) expect(maxJump(unwrap(ring))).toBeLessThan(180);
  }
  // Antarctica circles the South Pole, so its land closes over the pole instead of across the map.
  const ant = unwrap(byName("Antarctica").outer.reduce((a, b) => (a.length > b.length ? a : b)));
  expect(ant.at(-1)![1]).toBe(-90);
  // An ordinary country comes back as it was.
  const fr = byName("France").outer[0]!;
  expect(unwrap(fr)).toEqual(fr);
});
