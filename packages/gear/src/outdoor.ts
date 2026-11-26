// Sound out of doors: what the rock and the weather do to it between the hang and a seat (the air, the ground and the
// land are field.ts). Plain functions over the same `Source` and `Vec3` as sound.ts. Each number says where it comes from.
import { type Source, type Vec3, aimTo, levelAt1m, offAxisLoss } from "./sound.ts";

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
