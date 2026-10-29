// Points on the planet as unit vectors, and the few great-circle sums the course and the disc need.
// Frame: x through 0°E on the equator, y through 90°E, z through the north pole.

export const EARTH_KM = 6371;
export type Vec3 = [number, number, number];
export interface LatLon { lat: number; lon: number }

const RAD = Math.PI / 180, DEG = 180 / Math.PI;

export function toVec(p: LatLon, out: Vec3 = [0, 0, 0]): Vec3 {
  const la = p.lat * RAD, lo = p.lon * RAD, c = Math.cos(la);
  out[0] = c * Math.cos(lo); out[1] = c * Math.sin(lo); out[2] = Math.sin(la);
  return out;
}
export function toLatLon(v: Vec3): LatLon {
  const lon = Math.atan2(v[1], v[0]) * DEG;
  return { lat: Math.asin(Math.max(-1, Math.min(1, v[2]))) * DEG, lon: ((lon + 540) % 360) - 180 };
}
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3, out: Vec3 = [0, 0, 0]): Vec3 => {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z;
  return out;
};
export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}
export const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** Local east and north unit vectors at a point (the tangent plane's axes). */
export function frame(p: Vec3): { east: Vec3; north: Vec3 } {
  const east: Vec3 = normalize([-p[1], p[0], 0]);
  if (length(east) === 0 || Math.abs(p[2]) > 0.999999) { east[0] = 0; east[1] = 1; east[2] = 0; }
  const north = normalize(cross(p, east));
  return { east, north };
}

/** Great-circle distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const d = Math.max(-1, Math.min(1, dot(toVec(a), toVec(b))));
  return Math.acos(d) * EARTH_KM;
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearing(a: LatLon, b: LatLon): number {
  const la1 = a.lat * RAD, la2 = b.lat * RAD, dl = (b.lon - a.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/** The point `km` along the great circle leaving `from` on `bearingDeg`. */
export function destination(from: LatLon, bearingDeg: number, km: number): LatLon {
  const p = toVec(from);
  const { east, north } = frame(p);
  const b = bearingDeg * RAD, t = km / EARTH_KM;
  const dir: Vec3 = [
    north[0] * Math.cos(b) + east[0] * Math.sin(b),
    north[1] * Math.cos(b) + east[1] * Math.sin(b),
    north[2] * Math.cos(b) + east[2] * Math.sin(b),
  ];
  return toLatLon([
    p[0] * Math.cos(t) + dir[0] * Math.sin(t),
    p[1] * Math.cos(t) + dir[1] * Math.sin(t),
    p[2] * Math.cos(t) + dir[2] * Math.sin(t),
  ]);
}

/** `n` points along the great circle from a to b, a and b included. */
export function arc(a: LatLon, b: LatLon, n: number): LatLon[] {
  const km = distanceKm(a, b), brg = bearing(a, b);
  const out: LatLon[] = [];
  for (let k = 0; k < n; k++) out.push(k === 0 ? a : k === n - 1 ? b : destination(a, brg, (km * k) / (n - 1)));
  return out;
}

/** Degrees clockwise from north a wind of (u east, v north) is going to. */
export const windHeading = (u: number, v: number) => (Math.atan2(u, v) * DEG + 360) % 360;
/** The compass name of a heading, 8 points. */
export function compass(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}
