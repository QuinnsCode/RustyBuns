import { describe, expect, test } from "bun:test";
import { countryAt } from "../src/countries.ts";
import { decodeCurrents, encodeCurrents, PADDLE_KMS, startSwim, SWIM_S, swimKm, swimOver, swimStep } from "../src/currents.ts";
import { bearing, distanceKm, type LatLon } from "../src/geo.ts";
import { sampleWind } from "../src/grib2.ts";

const pack = decodeCurrents(new Uint8Array(await Bun.file(new URL("../src/currents.bin", import.meta.url)).arrayBuffer()));
const isSea = (p: LatLon) => countryAt(p) === null;
const swimAll = (from: LatLon, heading: number, paddling: boolean) => {
  const s = startSwim(from, heading);
  while (!swimOver(s)) swimStep(s, 0.1, pack.level, paddling, isSea);
  return s;
};

describe("the cached currents", () => {
  test("are NOAA's: the Gulf Stream runs, land and the open ocean barely move", () => {
    expect(pack.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const speed = (lat: number, lon: number) => Math.hypot(...sampleWind(pack.level, lat, lon));
    expect(speed(37.1, -67.9)).toBeGreaterThan(0.7);   // Gulf Stream off the Carolinas
    expect(speed(48.85, 2.35)).toBe(0);                // Paris
    expect(speed(-10, -140)).toBeLessThan(0.3);        // the middle of the Pacific
  });
  test("pack and unpack round-trip in 2 cm/s steps, land as zero", () => {
    const u = new Float32Array(360 * 180).fill(NaN), v = new Float32Array(360 * 180).fill(NaN);
    u[0] = 0.517; v[0] = -1.234; u[1] = 9; v[1] = 0;
    const back = decodeCurrents(encodeCurrents("2026-10-27", u, v));
    expect(back.day).toBe("2026-10-27");
    expect(back.level.u[0]).toBeCloseTo(0.52, 5);
    expect(back.level.v[0]).toBeCloseTo(-1.24, 5);
    expect(back.level.u[1]).toBeCloseTo(2, 5); // capped
    expect(back.level.u[2]).toBe(0);
  });
});

describe("a swim", () => {
  const gulf = { lat: 37.1, lon: -67.9 }, pacific = { lat: -10, lon: -140 };
  test("in the open ocean, paddling at the basket gains most of the paddle's reach", () => {
    const basket = { lat: -10, lon: -120 };
    const s = swimAll(pacific, bearing(pacific, basket), true);
    expect(s.t).toBe(SWIM_S);
    expect(distanceKm(pacific, basket) - distanceKm(s.pos, basket)).toBeGreaterThan(PADDLE_KMS * SWIM_S * 0.8);
  });
  test("in the Gulf Stream the current wins: idle, it carries the disc far; paddling upstream only slows it", () => {
    const idle = swimAll(gulf, 0, false);
    expect(swimKm(idle)).toBeGreaterThan(500);
    const upstream = swimAll(gulf, (bearing(gulf, idle.pos) + 180) % 360, true);
    expect(swimKm(upstream)).toBeLessThan(swimKm(idle));
  });
  test("reaching a shore ends it early, on land", () => {
    const offPortugal = { lat: 39.5, lon: -10 };
    const s = swimAll(offPortugal, 90, true);
    expect(s.ashore).toBe(true);
    expect(s.t).toBeLessThan(SWIM_S);
    expect(countryAt(s.pos)?.name).toBe("Portugal");
  });
});
