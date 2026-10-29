import { describe, expect, test } from "bun:test";
import { readGrib2, sampleWind, windLevels } from "../src/grib2.ts";

// NOAA's own file: GFS 1.00°, 2026-10-28 00z analysis, UGRD and VGRD at 10 m and 250 mb, as NOMADS'
// filter hands it out. Four messages, complex packing with spatial differencing.
const bytes = new Uint8Array(await Bun.file(new URL("./fixtures/gfs-1p00-2026-10-28-00z-f000.grib2", import.meta.url)).arrayBuffer());

describe("GFS wind grid", () => {
  const fields = readGrib2(bytes);
  test("reads the four fields on a 1° global grid", () => {
    expect(fields.map((f) => [f.parameter, f.level])).toEqual([
      ["UGRD", "250 mb"], ["VGRD", "250 mb"], ["UGRD", "10 m above ground"], ["VGRD", "10 m above ground"],
    ]);
    for (const f of fields) {
      expect(f.grid).toEqual({ ni: 360, nj: 181, la1: 90, lo1: 0, di: 1, dj: 1 });
      expect(f.values.length).toBe(360 * 181);
      expect(f.cycle.toISOString()).toBe("2026-10-28T00:00:00.000Z");
      expect(f.forecastHours).toBe(0);
    }
  });
  test("the numbers are winds, not noise", () => {
    const levels = windLevels(fields);
    expect(levels.map((l) => l.level)).toEqual(["250 mb", "10 m above ground"]);
    const [jet, surface] = levels as [typeof levels[0], typeof levels[0]];
    const speeds = (l: typeof jet) => Array.from(l.u, (u, i) => Math.hypot(u, l.v[i]!));
    const s = speeds(surface), j = speeds(jet);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    // Surface wind is a few m/s and never a hurricane everywhere; the jet is several times stronger.
    expect(Math.max(...s)).toBeLessThan(45);
    expect(mean(s)).toBeGreaterThan(3);
    expect(mean(s)).toBeLessThan(12);
    expect(Math.max(...j)).toBeGreaterThan(50);
    expect(Math.max(...j)).toBeLessThan(140);
    expect(mean(j)).toBeGreaterThan(mean(s) * 2);
    // Mid-latitude westerlies: the zonal mean of u at 45°N and 45°S aloft blows east.
    const row = (l: typeof jet, lat: number) => { const jj = 90 - lat; let t = 0; for (let i = 0; i < 360; i++) t += l.u[jj * 360 + i]!; return t / 360; };
    expect(row(jet, 45)).toBeGreaterThan(5);
    expect(row(jet, -45)).toBeGreaterThan(5);
    // A field is smooth: next-door points differ by a little, not by the whole range.
    let jumps = 0;
    for (let k = 1; k < surface.u.length; k++) if (Math.abs(surface.u[k]! - surface.u[k - 1]!) > 15) jumps++;
    expect(jumps).toBeLessThan(surface.u.length / 500);
  });
  test("sampling interpolates and wraps the date line", () => {
    const w = windLevels(fields)[1]!;
    const at = (lat: number, lon: number) => w.u[(90 - lat) * 360 + ((lon + 360) % 360)]!;
    expect(sampleWind(w, 35, 139)[0]).toBeCloseTo(at(35, 139), 5);
    expect(sampleWind(w, 35, -221)[0]).toBeCloseTo(at(35, 139), 5); // same meridian, written the other way
    const [u] = sampleWind(w, 35, 139.5);
    expect(u).toBeCloseTo((at(35, 139) + at(35, 140)) / 2, 5);
    const [u2] = sampleWind(w, 0, 359.5);
    expect(u2).toBeCloseTo((at(0, 359) + at(0, 0)) / 2, 5);
  });
  test("a file that is not GRIB says so", () => {
    expect(() => readGrib2(new TextEncoder().encode("<html>Data file is not present</html>"))).toThrow(/not GRIB/);
  });
});
