// The sea. A disc that lands in the water floats, and the real ocean current takes it: NOAA CoastWatch's
// daily surface currents (from satellite altimetry). The Worker relays the latest day (/api/currents); a
// copy in src/currents.bin (`bun run currents`) plays when it can't, and on the desktop.
// For SWIM_S seconds the player paddles against it; the Gulf Stream or the Agulhas will carry a disc a
// thousand kilometres back the way it came, the open ocean barely moves it. Landing on a shore ends it.
//
// currents.bin: "CUR1", the day as "YYYY-MM-DD", two zero bytes, then u and v (east, north) as int8 in
// steps of 2 cm/s, 360 x 180 each, north row first from 89.125°, west column first from -179.875°.
// -128 is land or no data. Speeds are capped at MAX_MS: geostrophic currents blow up near the equator and
// in narrow straits, where the altimetry can't see the real flow.
import { bearing, destination, distanceKm, type LatLon } from "./geo.ts";
import { sampleWind, type WindLevel } from "./grib2.ts";

export interface Currents { level: WindLevel; day: string; live: boolean }

/** ERDDAP's binary (.dods) answer for the latest day, every fourth 0.25° point: one 1 MB request. */
export const ERDDAP_URL = (() => {
  const span = "[(last)][(-89.875):4:(89.875)][(-179.875):4:(179.875)]";
  return `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily.dods?${encodeURIComponent(`u_current${span},v_current${span}`)}`;
})();

const NI = 360, NJ = 180, HEAD = 16, STEP_MS = 0.02, NONE = -128, MAX_MS = 2;
const GRID = { ni: NI, nj: NJ, la1: 89.125, lo1: -179.875, di: 1, dj: 1 };

export function encodeCurrents(day: string, u: Float32Array, v: Float32Array): Uint8Array {
  const out = new Uint8Array(HEAD + 2 * NI * NJ);
  out.set(new TextEncoder().encode(`CUR1${day.slice(0, 10)}`));
  const q = (x: number) => (Number.isFinite(x) ? Math.max(-127, Math.min(127, Math.round(x / STEP_MS))) : NONE) & 0xff;
  for (let k = 0; k < NI * NJ; k++) {
    const cap = Math.min(1, MAX_MS / (Math.hypot(u[k]!, v[k]!) || 1));
    out[HEAD + k] = q(u[k]! * cap); out[HEAD + NI * NJ + k] = q(v[k]! * cap);
  }
  return out;
}

/** ERDDAP's .dods (OPeNDAP's XDR) for u then v: each a grid of float64s, south row first, then its time,
 * latitude and longitude maps; every array is led by its length twice. Packed as above. */
export function packDods(bytes: Uint8Array): Uint8Array {
  const at = indexOf(bytes, "Data:\n");
  if (at < 0) throw new Error("not an OPeNDAP answer");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = NI * NJ;
  let p = at + 6;
  const grid = (): [Float32Array, number] => {
    if (dv.getUint32(p) !== n) throw new Error(`a grid of ${dv.getUint32(p)} points, want ${n}`);
    p += 8;
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = dv.getFloat64(p + 8 * k), j = NJ - 1 - Math.floor(k / NI);
      out[j * NI + (k % NI)] = x < -1000 ? NaN : x; // the fill value is -214748.36
    }
    p += 8 * n + 8;
    const time = dv.getFloat64(p);
    p += 8 + 8 + 4 * NJ + 8 + 4 * NI;
    return [out, time];
  };
  const [u, time] = grid(), [v] = grid();
  if (p !== bytes.length) throw new Error(`OPeNDAP answer is ${bytes.length} bytes, read ${p}`);
  return encodeCurrents(new Date(time * 1000).toISOString(), u, v);
}

function indexOf(b: Uint8Array, s: string): number {
  const t = new TextEncoder().encode(s);
  outer: for (let i = 0; i + t.length <= Math.min(b.length, 4096); i++) {
    for (let k = 0; k < t.length; k++) if (b[i + k] !== t[k]) continue outer;
    return i;
  }
  return -1;
}

export function decodeCurrents(bytes: Uint8Array, live = false): Currents {
  if (bytes.length !== HEAD + 2 * NI * NJ || new TextDecoder().decode(bytes.subarray(0, 4)) !== "CUR1") throw new Error("not a currents pack");
  const day = new TextDecoder().decode(bytes.subarray(4, 14));
  const s = new Int8Array(bytes.buffer, bytes.byteOffset + HEAD, 2 * NI * NJ);
  const u = new Float32Array(NI * NJ), v = new Float32Array(NI * NJ);
  for (let k = 0; k < NI * NJ; k++) {
    const a = s[k]!, b = s[NI * NJ + k]!;
    u[k] = a === NONE ? 0 : a * STEP_MS;
    v[k] = b === NONE ? 0 : b * STEP_MS;
  }
  return { level: { grid: GRID, level: "ocean surface", u, v }, day, live };
}

/** Seconds the swim lasts. */
export const SWIM_S = 10;
/** km of drift per second per m/s of current: a 1 m/s stream carries the disc 1,500 km over a swim. */
export const SEA_DRIFT = 150;
/** km/s the alien paddles at: beats the open ocean, loses to the big western boundary currents. */
export const PADDLE_KMS = 60;

export interface Swim {
  pos: LatLon;
  start: LatLon;
  t: number;          // s swum
  heading: number;    // where the paddling points, degrees
  ashore: boolean;    // reached land: the swim is over, the disc lies there
  maxCurrent: number; // strongest current met, m/s
}

export const startSwim = (pos: LatLon, heading: number): Swim => ({ pos, start: pos, t: 0, heading, ashore: false, maxCurrent: 0 });
export const swimOver = (s: Swim) => s.ashore || s.t >= SWIM_S;
/** How far the swim ended from where the disc went in, km. */
export const swimKm = (s: Swim) => distanceKm(s.start, s.pos);

/** One step: the current drifts the disc, paddling pushes it along `heading`, land stops it. */
export function swimStep(s: Swim, dt: number, cur: WindLevel | null, paddling: boolean, isSea: (p: LatLon) => boolean, out: [number, number] = [0, 0]): Swim {
  if (swimOver(s)) return s;
  dt = Math.min(dt, SWIM_S - s.t);
  let e = 0, n = 0;
  if (cur) {
    sampleWind(cur, s.pos.lat, s.pos.lon, out);
    s.maxCurrent = Math.max(s.maxCurrent, Math.hypot(out[0], out[1]));
    e = out[0] * SEA_DRIFT; n = out[1] * SEA_DRIFT;
  }
  if (paddling) {
    const b = (s.heading * Math.PI) / 180;
    e += Math.sin(b) * PADDLE_KMS; n += Math.cos(b) * PADDLE_KMS;
  }
  s.t += dt;
  const km = Math.hypot(e, n) * dt;
  if (km > 0) {
    s.pos = destination(s.pos, (Math.atan2(e, n) * 180) / Math.PI, km);
    s.ashore = !isSea(s.pos);
  }
  return s;
}

/** The paddle heading that points at the basket, for a fresh swim. */
export const paddleToward = (from: LatLon, to: LatLon) => Math.round(bearing(from, to));

/** Today's currents from the Worker, or the copy shipped with the page, or none (the sea is then just sea). */
export async function loadCurrents(cachedUrl: string, liveUrl: string | null = "/api/currents"): Promise<Currents | null> {
  for (const [url, live] of [[liveUrl, true], [cachedUrl, false]] as const) {
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (res.ok) return decodeCurrents(new Uint8Array(await res.arrayBuffer()), live);
    } catch { /* try the next */ }
  }
  return null;
}
