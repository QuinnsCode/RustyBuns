// The disc's flight. An alien disc doesn't fall: it hovers for a hang time set by the throw's power and
// slides with the real wind the whole way. The throw sets the heading and how far it would carry in still
// air; the wind at the disc's own position, read every step from NOAA's grid, drifts it. A low throw
// rides the surface wind; a lofted one rides the jet stream, several times stronger and the gamble.
import { clamp } from "@rustybuns/util";
import { cross, dot, EARTH_KM, frame, normalize, toLatLon, toVec, type LatLon, type Vec3 } from "./geo.ts";
import { sampleWind, type WindLevel } from "./grib2.ts";

export type Loft = "low" | "high";
export interface Throw { from: LatLon; heading: number; power: number; loft: Loft }
export interface Flight {
  path: LatLon[];       // sampled every STEP seconds of flight, start and landing included
  landing: LatLon;
  hangTime: number;     // s
  windDriftKm: number;  // how far the wind carried it, measured against the still-air landing
  stillAir: LatLon;     // where it would have landed with no wind
  maxWind: number;      // strongest wind met on the way, m/s
}

export const MAX_POWER = 10;
export const MIN_POWER = 0.5;
export const POWER_STEP = 0.5;
const STEP = 0.1;                           // s of flight per sample
/** Still-air carry of a throw at this power, km. Power 10 is 4,600 km; a half-power putt 230. */
export const carryKm = (power: number) => 460 * clamp(power, MIN_POWER, MAX_POWER);
/** The power whose still-air carry is this distance, on the slider's steps. */
export const powerFor = (km: number) => clamp(Math.round(km / 460 / POWER_STEP) * POWER_STEP, MIN_POWER, MAX_POWER);
/** How long the disc hovers: longer throws hang longer, so the wind has longer to work. */
export const hangTime = (power: number, loft: Loft) => (1 + 0.9 * power) * (loft === "high" ? 1.5 : 1);
/** km of drift per second of flight per m/s of wind. The jet is stronger, so it gets a smaller factor; still a bigger total. */
export const DRIFT: Record<Loft, number> = { low: 20, high: 6 };

/** The wind the disc rides on each loft: surface for low, the 250 mb jet for high (or whatever levels there are). */
export function levelFor(levels: WindLevel[], loft: Loft): WindLevel | null {
  if (levels.length === 0) return null;
  const sfc = levels.find((l) => l.level.includes("above ground")) ?? levels[levels.length - 1]!;
  const jet = levels.find((l) => l.level.includes("mb")) ?? sfc;
  return loft === "high" ? jet : sfc;
}

export function simulateThrow(t: Throw, wind: WindLevel | null): Flight {
  const T = hangTime(t.power, t.loft);
  const steps = Math.ceil(T / STEP);
  const dt = T / steps;
  const speed = carryKm(t.power) / T; // km/s along the throw, constant: an alien disc doesn't slow
  const drift = DRIFT[t.loft];         // km/s of drift per m/s of wind
  const p = toVec(t.from);
  const still = toVec(t.from);
  // Throw direction as a tangent vector; carried along the great circle by parallel transport.
  const f0 = frame(p);
  const b = (t.heading * Math.PI) / 180;
  const dir: Vec3 = normalize([
    f0.north[0] * Math.cos(b) + f0.east[0] * Math.sin(b),
    f0.north[1] * Math.cos(b) + f0.east[1] * Math.sin(b),
    f0.north[2] * Math.cos(b) + f0.east[2] * Math.sin(b),
  ]);
  const stillDir: Vec3 = [dir[0], dir[1], dir[2]];
  const path: LatLon[] = [t.from];
  const w: [number, number] = [0, 0];
  let maxWind = 0;
  const advance = (pos: Vec3, vel: Vec3, km: number) => {
    // Move along the tangent, back onto the sphere, and keep the heading tangent to the new point.
    const a = km / EARTH_KM;
    pos[0] += vel[0] * a; pos[1] += vel[1] * a; pos[2] += vel[2] * a;
    normalize(pos);
    const d = dot(vel, pos);
    vel[0] -= d * pos[0]; vel[1] -= d * pos[1]; vel[2] -= d * pos[2];
    normalize(vel);
  };
  for (let k = 0; k < steps; k++) {
    const here = toLatLon(p);
    let drift3: Vec3 = [0, 0, 0];
    if (wind) {
      sampleWind(wind, here.lat, here.lon, w);
      const s = Math.hypot(w[0], w[1]);
      if (s > maxWind) maxWind = s;
      const { east, north } = frame(p);
      drift3 = [
        (east[0] * w[0] + north[0] * w[1]) * drift,
        (east[1] * w[0] + north[1] * w[1]) * drift,
        (east[2] * w[0] + north[2] * w[1]) * drift,
      ];
    }
    const vel: Vec3 = [dir[0] * speed + drift3[0], dir[1] * speed + drift3[1], dir[2] * speed + drift3[2]];
    const km = Math.hypot(vel[0], vel[1], vel[2]) * dt;
    normalize(vel);
    const before: Vec3 = [p[0], p[1], p[2]];
    advance(p, vel, km);
    // The throw's own heading keeps following the great circle it set out on (transport it by the same rotation the position made).
    transport(dir, before, p);
    advance(still, stillDir, speed * dt);
    path.push(toLatLon(p));
  }
  const landing = path[path.length - 1]!;
  const stillAir = toLatLon(still);
  return { path, landing, hangTime: T, windDriftKm: Math.acos(clamp(dot(p, still), -1, 1)) * EARTH_KM, stillAir, maxWind };
}

/** Rotate tangent vector v from the tangent plane at a to the one at b, the way the sphere turned a into b. */
function transport(v: Vec3, a: Vec3, b: Vec3) {
  const axis = cross(a, b);
  const s = Math.hypot(axis[0], axis[1], axis[2]);
  if (s < 1e-12) return;
  normalize(axis);
  const c = clamp(dot(a, b), -1, 1);
  const ang = Math.atan2(s, c);
  // Rodrigues' rotation of v about axis by ang.
  const k = axis, cosA = Math.cos(ang), sinA = Math.sin(ang);
  const kv = cross(k, v);
  const kd = dot(k, v);
  v[0] = v[0] * cosA + kv[0] * sinA + k[0] * kd * (1 - cosA);
  v[1] = v[1] * cosA + kv[1] * sinA + k[1] * kd * (1 - cosA);
  v[2] = v[2] * cosA + kv[2] * sinA + k[2] * kd * (1 - cosA);
  normalize(v);
}

/** A stand-in wind for when NOAA can't be reached: trade winds, westerlies and a wavy jet, seeded. */
export function syntheticWind(seed = 7): WindLevel[] {
  const ni = 360, nj = 181;
  const grid = { ni, nj, la1: 90, lo1: 0, di: 1, dj: 1 };
  const mk = (jet: boolean) => {
    const u = new Float32Array(ni * nj), v = new Float32Array(ni * nj);
    for (let j = 0; j < nj; j++) {
      const lat = 90 - j, phi = (lat * Math.PI) / 180;
      for (let i = 0; i < ni; i++) {
        const lam = (i * Math.PI) / 180;
        const wave = Math.sin(3 * lam + seed) * 12 + Math.sin(5 * lam - seed * 0.7) * 6;
        const belt = jet
          ? 45 * Math.exp(-(((Math.abs(lat) - 38 - wave * 0.3) / 10) ** 2)) * Math.sign(1 + 0.001 * lat)
          : -6 * Math.cos(phi) * Math.cos(3 * phi) + 7 * Math.sin(2 * phi) ** 2 * (Math.abs(lat) > 30 ? 1 : 0);
        u[j * ni + i] = belt + (jet ? 0 : Math.sin(lam * 4 + seed) * 2);
        v[j * ni + i] = (jet ? 12 : 3) * Math.sin(2 * lam + seed + phi * 3) * Math.cos(phi);
      }
    }
    return { grid, level: jet ? "250 mb" : "10 m above ground", u, v };
  };
  return [mk(true), mk(false)];
}
