import { describe, expect, test } from "bun:test";
import { countryAt, countries, inCountry } from "../src/countries.ts";
import { coursePar, makeCourse, MAX_KM, MIN_KM, playable } from "../src/course.ts";
import { bearing, destination, distanceKm } from "../src/geo.ts";

describe("the planet", () => {
  test.each([
    ["Tokyo", 35.68, 139.69, "Japan"],
    ["Nairobi", -1.29, 36.82, "Kenya"],
    ["Denver", 39.74, -104.99, "United States of America"],
    ["mid-Pacific", 0, -150, null],
    ["Lesotho's hole in South Africa", -29.6, 28.2, "Lesotho"],
  ])("%s is in %p", (_name, lat, lon, want) => {
    expect(countryAt({ lat, lon })?.name ?? null).toBe(want);
  });
  test("great-circle sums close", () => {
    const tokyo = { lat: 35.68, lon: 139.69 }, sydney = { lat: -33.87, lon: 151.21 };
    const km = distanceKm(tokyo, sydney);
    expect(km).toBeGreaterThan(7700); expect(km).toBeLessThan(7900);
    const there = destination(tokyo, bearing(tokyo, sydney), km);
    expect(there.lat).toBeCloseTo(sydney.lat, 3);
    expect(there.lon).toBeCloseTo(sydney.lon, 3);
  });
});

describe("a course", () => {
  const list = playable();
  test("leaves out specks and the ice, keeps the big ones", () => {
    const names = list.map((c) => c.name);
    expect(names).toContain("Brazil"); expect(names).toContain("Mongolia"); expect(names).toContain("New Zealand");
    expect(names).not.toContain("Antarctica"); expect(names).not.toContain("Greenland");
    expect(list.length).toBeGreaterThan(100);
  });
  test("the same seed is the same course, and every hole is playable", () => {
    const a = makeCourse(2026), b = makeCourse(2026);
    expect(a).toEqual(b);
    expect(a.holes.length).toBe(9);
    for (const h of a.holes) {
      expect(h.km).toBeGreaterThanOrEqual(MIN_KM); expect(h.km).toBeLessThanOrEqual(MAX_KM);
      expect(h.teeCountry).not.toBe(h.basketCountry);
      expect(h.guesses.length).toBe(4); expect(h.guesses).toContain(h.teeCountry);
      expect(inCountry(countries().find((c) => c.name === h.teeCountry)!, h.tee)).toBe(true);
      expect(inCountry(countries().find((c) => c.name === h.basketCountry)!, h.basket)).toBe(true);
    }
    expect(coursePar(a)).toBeGreaterThanOrEqual(27);
    expect(makeCourse(2027).holes[0]!.tee).not.toEqual(a.holes[0]!.tee);
  });
});
