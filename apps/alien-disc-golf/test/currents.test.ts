import { describe, expect, test } from "bun:test";
import { countryAt } from "../src/countries.ts";
import { decodeCurrents, encodeCurrents, packDods, PADDLE_KMS, startSwim, SWIM_S, swimKm, swimOver, swimStep } from "../src/currents.ts";
import { currentsResponse } from "../src/edge/worker.ts";
import { bearing, distanceKm, type LatLon } from "../src/geo.ts";
import { sampleWind } from "../src/grib2.ts";

const pack = decodeCurrents(new Uint8Array(await Bun.file(new URL("../src/currents.bin", import.meta.url)).arrayBuffer()));
const isSea = (p: LatLon) => countryAt(p) === null;
const speed = (p: LatLon) => Math.hypot(...sampleWind(pack.level, p.lat, p.lon));
const swimAll = (from: LatLon, heading: number, paddling: boolean) => {
  const s = startSwim(from, heading);
  while (!swimOver(s)) swimStep(s, 0.1, pack.level, paddling, isSea);
  return s;
};
/** The fastest open water in a box (2° clear of land), so a table row holds whatever day the pack is from. */
const offshore = (p: LatLon) => [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([a, b]) => isSea({ lat: p.lat + a!, lon: p.lon + b! }));
const fastestIn = (lat0: number, lat1: number, lon0: number, lon1: number): LatLon => {
  let best = { lat: lat0, lon: lon0 }, top = -1;
  for (let lat = lat0; lat <= lat1; lat += 0.5) for (let lon = lon0; lon <= lon1; lon += 0.5) {
    const p = { lat, lon };
    if (speed(p) > top && offshore(p)) { best = p; top = speed(p); }
  }
  return best;
};

/** An ERDDAP .dods answer as CoastWatch writes it: u then v, each with its time, latitude and longitude maps. */
function dods(u: (k: number) => number, v: (k: number) => number, time: number): Uint8Array<ArrayBuffer> {
  const n = 360 * 180, head = new TextEncoder().encode("Dataset {\n  GRID { ... } u_current;\n} x;\nData:\n");
  const out = new Uint8Array(head.length + 2 * (8 + 8 * n + 8 + 8 + 8 + 4 * 180 + 8 + 4 * 360));
  out.set(head);
  const dv = new DataView(out.buffer);
  let p = head.length;
  const len = (k: number) => { dv.setUint32(p, k); dv.setUint32(p + 4, k); p += 8; };
  for (const f of [u, v]) {
    len(n); for (let k = 0; k < n; k++, p += 8) dv.setFloat64(p, f(k));
    len(1); dv.setFloat64(p, time); p += 8;
    len(180); p += 4 * 180;
    len(360); p += 4 * 360;
  }
  return out;
}

describe("the currents", () => {
  test("the cached copy is NOAA's: the Gulf Stream runs, land is still", () => {
    expect(pack.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(speed(fastestIn(34, 41, -75, -60))).toBeGreaterThan(0.8);
    expect(speed({ lat: 48.85, lon: 2.35 })).toBe(0); // Paris
  });
  test("ERDDAP's answer packs south-up to north-first, fill as land, and caps the equator's blow-ups", () => {
    // u is 0.3 everywhere but the first (south-west) point, which is fill; v is 5 m/s on the last row (north).
    const bytes = dods((k) => (k === 0 ? -214748.3648 : 0.3), (k) => (k >= 179 * 360 ? 5 : 0), Date.UTC(2026, 9, 27) / 1000);
    const c = decodeCurrents(packDods(bytes));
    expect(c.day).toBe("2026-10-27");
    expect(c.level.u[179 * 360]).toBe(0);              // south-west corner, now the last row
    expect(c.level.u[179 * 360 + 1]).toBeCloseTo(0.3, 5);
    expect(Math.hypot(c.level.u[5]!, c.level.v[5]!)).toBeCloseTo(2, 1); // north row: capped from 5 m/s
    expect(() => packDods(new TextEncoder().encode("<html>Proxy Error</html>"))).toThrow();
  });
  test("the Worker asks ERDDAP once per six hours, and serves its last copy when ERDDAP is down", async () => {
    let asked = 0, up = true;
    const fetcher = (async () => { asked++; return up ? new Response(dods(() => 0.1, () => 0, 1.79e9)) : new Response("down", { status: 502 }); }) as unknown as typeof fetch;
    const t0 = new Date("2030-01-01T00:00:00Z");
    for (const dt of [0, 60e3, 3600e3]) expect((await currentsResponse(new Date(t0.getTime() + dt), fetcher)).status).toBe(200);
    expect(asked).toBe(1);
    up = false;
    const stale = await currentsResponse(new Date(t0.getTime() + 7 * 3600e3), fetcher);
    expect(stale.headers.get("X-Stale")).toBe("1");
    expect(decodeCurrents(new Uint8Array(await stale.arrayBuffer())).level.u[0]).toBeCloseTo(0.1, 5);
  });
  test("pack round-trips in 2 cm/s steps", () => {
    const u = new Float32Array(360 * 180), v = new Float32Array(360 * 180);
    u[0] = 0.517; v[0] = -1.234;
    const back = decodeCurrents(encodeCurrents("2026-10-27", u, v));
    expect(back.level.u[0]).toBeCloseTo(0.52, 5);
    expect(back.level.v[0]).toBeCloseTo(-1.24, 5);
  });
});

describe("a swim", () => {
  // What SWIM_S, SEA_DRIFT and PADDLE_KMS add up to: idle, the Gulf Stream carries the disc
  // hundreds of km and a calm sea barely moves it.
  test.each([
    ["the Gulf Stream", 400, 2000, fastestIn(34, 41, -75, -60)],
    ["the Kuroshio", 400, 2500, fastestIn(30, 37, 130, 150)],
    ["the Agulhas", 100, 2500, fastestIn(-42, -30, 15, 35)],
    ["the South Pacific gyre", 0, 400, { lat: -25, lon: -120 }],
    ["the Mediterranean", 0, 400, { lat: 35, lon: 18 }],
  ] as const)("idle in %s drifts between %i and %i km", (_n, lo, hi, from) => {
    const s = swimAll(from, 0, false);
    expect(swimKm(s)).toBeGreaterThanOrEqual(lo);
    expect(swimKm(s)).toBeLessThanOrEqual(hi);
  });
  test("in the open ocean, paddling at the basket gains most of the paddle's reach", () => {
    const from = { lat: -25, lon: -120 }, basket = { lat: -25, lon: -100 };
    const s = swimAll(from, bearing(from, basket), true);
    expect(s.t).toBe(SWIM_S);
    expect(distanceKm(from, basket) - distanceKm(s.pos, basket)).toBeGreaterThan(PADDLE_KMS * SWIM_S * 0.6);
  });
  test("in the Gulf Stream the current wins: paddling upstream only slows the drift", () => {
    const gulf = fastestIn(34, 41, -75, -60);
    const idle = swimAll(gulf, 0, false);
    const upstream = swimAll(gulf, (bearing(gulf, idle.pos) + 180) % 360, true);
    expect(swimKm(upstream)).toBeLessThan(swimKm(idle));
  });
  test("reaching a shore ends it early, on land", () => {
    const s = swimAll({ lat: 39.5, lon: -10 }, 90, true); // off Portugal, paddling east
    expect(s.ashore).toBe(true);
    expect(s.t).toBeLessThan(SWIM_S);
    expect(countryAt(s.pos)?.name).toBe("Portugal");
  });
});
