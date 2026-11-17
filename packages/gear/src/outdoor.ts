// Sound out of doors: what the air, the rock and the weather do to it between the hang and a seat. Plain functions over
// the same `Source` and `Vec3` as sound.ts. Each number says where it comes from.
import { type Source, type Vec3, aimTo, levelAt1m, offAxisLoss } from "./sound.ts";

/** Sea-level standard pressure, kPa (ISO 2533). */
export const SEA_LEVEL_KPA = 101.325;

/** Air pressure at an altitude, kPa: the barometric formula with an 8.4 km scale height (air at about 15 C). At 1,950 m
 * that is about 80 kPa, a fifth thinner than at the sea. */
export function pressureAt(altitudeM: number): number {
  return SEA_LEVEL_KPA * Math.exp(-altitudeM / 8434);
}

/** The speed of sound in dry air at a temperature, m/s: 331.3 √(1 + T / 273.15). It hangs on temperature alone, not on
 * pressure, so thin air at altitude carries sound no faster; a warm afternoon (30 C, 349 m/s) against a cool night
 * (12 C, 338 m/s) moves a 100 m delay by about 9 ms. */
export function speedOfSound(tempC: number): number {
  return 331.3 * Math.sqrt(1 + tempC / 273.15);
}

/**
 * Air absorption, dB per metre, at `freq` Hz (ISO 9613-1:1993, the full formula: oxygen and nitrogen relaxation and the
 * classical loss). Dry air takes the highs harder: at 8 kHz and 20 C, 50% humidity is about 0.11 dB/m and 15% about
 * 0.24 dB/m, so 100 m of dry air takes 20 dB or more off the top octave. Thinner air at altitude shifts the
 * relaxation peaks down and takes a little more again.
 */
export function airAbsorption(freq: number, tempC: number, humidity: number, kPa = SEA_LEVEL_KPA): number {
  const T = tempC + 273.15, T0 = 293.15, T01 = 273.16, pr = kPa / SEA_LEVEL_KPA;
  // Molar concentration of water vapour, percent, from the relative humidity and the saturation pressure.
  const psat = 10 ** (-6.8346 * (T01 / T) ** 1.261 + 4.6151);
  const h = (humidity * psat) / pr;
  const frO = pr * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h));
  const frN = pr * (T / T0) ** -0.5 * (9 + 280 * h * Math.exp(-4.17 * ((T / T0) ** (-1 / 3) - 1)));
  const f2 = freq * freq;
  return 8.686 * f2 * (1.84e-11 / pr * (T / T0) ** 0.5
    + (T / T0) ** -2.5 * ((0.01275 * Math.exp(-2239.1 / T)) / (frO + f2 / frO) + (0.1068 * Math.exp(-3352 / T)) / (frN + f2 / frN)));
}

/** A flat face of rock: a point on it, its unit normal (pointing out into the air the sound comes through), and the
 * stretch of it there is (the reflection must land inside it). */
export type Face = { at: Vec3; normal: Vec3; z0: number; z1: number; top: number };

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mirror = (p: Vec3, f: Face): Vec3 => {
  const d = 2 * dot(sub(p, f.at), f.normal);
  return { x: p.x - d * f.normal.x, y: p.y - d * f.normal.y, z: p.z - d * f.normal.z };
};

/** What sandstone gives back, dB lost at the bounce: a hard face (absorption under 0.05 in the mids), but rough and
 * bedded, so some of it scatters away from the mirror direction. 2 dB is a fair middle for a weathered cliff. */
export const ROCK_LOSS_DB = 2;

/**
 * The echo off one rock face at a listener, by the image-source method: the speaker mirrored in the face, its axis
 * mirrored too, so the speaker's own pattern says how hard it sprays the rock. Null when the bounce point falls off the
 * face (past its ends or over its top) or the listener is behind it. `level` is dB SPL of the reflection at `p` (air
 * absorption left to the caller, by path), `path` its length in metres.
 */
export function reflection(src: Source, f: Face, p: Vec3, lossDb = ROCK_LOSS_DB): { level: number; path: number } | null {
  if (dot(sub(src.pos, f.at), f.normal) <= 0 || dot(sub(p, f.at), f.normal) <= 0) return null;
  const img = mirror(src.pos, f), path = dist(img, p);
  // Where the line from the image to the listener crosses the face.
  const a = dot(sub(img, f.at), f.normal), b = dot(sub(p, f.at), f.normal), s = a / (a - b);
  const hit = { x: img.x + (p.x - img.x) * s, y: img.y + (p.y - img.y) * s, z: img.z + (p.z - img.z) * s };
  if (hit.z < f.z0 || hit.z > f.z1 || hit.y > f.top || hit.y < 0) return null;
  // The speaker's own aim at the bounce point says how much of it goes that way.
  const { h, v } = aimTo(src, hit);
  const level = levelAt1m(src.speaker, src.watts) - 20 * Math.log10(path) - offAxisLoss(src.speaker, h, v) - lossDb;
  return { level, path };
}

/** A late arrival is heard as an echo, not as part of the sound, when it lands more than this after the first
 * (about 17 m of extra path): the precedence effect fuses what comes in sooner (Haas, 1951; for speech 30 to 50 ms). */
export const ECHO_MS = 50;
/** And when it is no more than this far under the first arrival, dB: quieter than that and it hides (the Haas curve
 * lets a 50 ms reflection sit about 10 dB down before it is heard as a separate sound). */
export const ECHO_DB = -10;

/** One arrival at a seat: its level, dB, and when it lands, ms. */
export type Arrival = { db: number; ms: number };

/** The worst echo among arrivals: the loudest arrival landing more than ECHO_MS after the first strong one (within
 * 10 dB of the loudest), as dB over or under the loudest and how late. Null when nothing lands late. */
export function echoOf(arrivals: readonly Arrival[]): { db: number; ms: number } | null {
  if (!arrivals.length) return null;
  const top = Math.max(...arrivals.map((a) => a.db));
  const first = Math.min(...arrivals.filter((a) => a.db >= top - 10).map((a) => a.ms));
  let worst: { db: number; ms: number } | null = null;
  for (const a of arrivals) if (a.ms - first > ECHO_MS && (!worst || a.db - top > worst.db)) worst = { db: a.db - top, ms: a.ms - first };
  return worst;
}

/**
 * Wind and temperature bend sound: speed rises with height when the wind blows along the sound's way (a tailwind) or
 * the air is warmer aloft (an inversion), so rays curve down; a headwind or the usual daytime lapse curves them up. A
 * ray in a linear speed gradient g (1/s) is a circle of radius c / g, so after `d` metres a beam arrives tilted by
 * about d g / 2c radians. Returned positive when it bends down (the speaker must aim that much higher to land on the
 * same seat), negative when it lifts. `windAlong` is the wind at about 10 m along the sound's way (m/s, negative into
 * it); near the ground wind grows with the log of height (roughness 5 cm for rock and benches), so its gradient at
 * `height` is windAlong / (height ln(height / 0.05)). `tempGradient` is K per metre (the dry lapse -0.0098; a night
 * inversion over a valley +0.02 to +0.1), and the speed of sound moves 0.6 m/s per K. Over the 100 m of a bowl that is
 * about a degree; over the 1.5 km to the houses it decides whether they hear the show (`weatherAtDistance`).
 */
export function bendAngle(d: number, windAlong: number, tempGradient = -0.0098, height = 10, c = 343): number {
  const h = Math.max(1, height), g = windAlong / (h * Math.log(h / 0.05)) + 0.6 * tempGradient;
  return (d * g) / (2 * c);
}

/**
 * The weather's say at a far listener (a house down the valley), dB: the correction a long-range noise model makes for
 * how the air bends sound over the ground and any barrier in the way. After CONCAWE's meteorological categories
 * (Manning, 1981): about -10 dB upwind on a sunny afternoon to +5 dB downwind under a night inversion at 1 to 2 km,
 * growing with distance from nothing at 100 m to the full swing past 1 km.
 */
export function weatherAtDistance(d: number, windAlong: number, inversion: boolean): number {
  const grow = Math.max(0, Math.min(1, Math.log10(Math.max(d, 100) / 100)));
  const raw = Math.max(-10, Math.min(5, 1.5 * windAlong + (inversion ? 4 : -2)));
  return Math.round(raw * grow * 10) / 10;
}

/** A barrier between the source and the listener (a rock behind the stage): Maekawa's chart, 10 log10(3 + 20 N) dB
 * with N the Fresnel number, 2 × the extra path over the top / wavelength. Bass bends round it; the highs don't. */
export function barrierLoss(extraPath: number, freq: number, c = 343): number {
  const n = (2 * extraPath * freq) / c;
  return Math.min(20, 10 * Math.log10(3 + 20 * Math.max(0, n)));
}
