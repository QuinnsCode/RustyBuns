// The home page's camera: a slow, nature-documentary flight over a park. It sweeps round a few focal points
// from a high, narrow, near-isometric angle, then climbs to the highest ground for one wide pan over everything.
// A pure function of time, so the page, a test and a screenshot all see the same shot.
import type { Level } from "../level.ts";
import type { Landmark, ParkLevel } from "../levels/park.ts";

export type Shot = { pos: [number, number, number]; look: [number, number, number]; fov: number };
type Stop = { x: number; z: number; peak: boolean };

/** Seconds on each stop, the last part of which is the flight to the next one. */
export const STOP_SECONDS = 30;
const FLIGHT = 0.5; // fraction of a stop spent flying on to the next
const ISO = { fov: 30, dist: 150, rise: 0.62 }; // a narrow lens from far off and 35 degrees up reads as isometric
const PEAK = { fov: 58, up: 9 };
const CLEAR = 4; // metres the camera keeps above the ground

const smooth = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const landmarkAt = (m: Landmark) => m.kind === "falls" ? { x: (m.from.x + m.to.x) / 2, z: (m.from.z + m.to.z) / 2 } : { x: m.x, z: m.z };

/** Where the camera lingers: the spawn, what the park is known for, its biggest pieces, and last the highest ground. */
export function tourStops(level: Level | ParkLevel): Stop[] {
  const stops: Stop[] = [];
  const far = (x: number, z: number) => stops.every((s) => Math.hypot(s.x - x, s.z - z) > 50);
  const add = (x: number, z: number) => { if (far(x, z)) stops.push({ x, z, peak: false }); };
  const spawn = level.spawns.find((s) => s.name === "skate") ?? level.spawns[0];
  if (spawn) add(spawn.x, spawn.z);
  const marks = "landmarks" in level ? level.landmarks : [];
  for (const m of marks.slice(0, 1)) { const p = landmarkAt(m); add(p.x, p.z); }
  for (const p of [...level.pieces].sort((a, b) => b.w * b.d - a.w * a.d).slice(0, 12)) { if (stops.length >= 4) break; add(p.x, p.z); }
  const b = level.bounds, step = 12;
  let best = { x: 0, z: 0, h: -Infinity };
  for (let x = b.minX; x <= b.maxX; x += step) for (let z = b.minZ; z <= b.maxZ; z += step) { const h = level.height(x, z); if (h > best.h) best = { x, z, h }; }
  stops.push({ x: best.x, z: best.z, peak: true });
  return stops;
}

/** The shot at the end of a stop's own sweep, `u` in 0..1 through it. */
function hover(level: Level, s: Stop, i: number, u: number): Shot {
  const ground = level.height(s.x, s.z);
  if (s.peak) { // on top: a quarter turn of the view, looking out and a little down
    const a = i * 1.7 + u * 1.6, dx = Math.sin(a), dz = Math.cos(a), y = ground + PEAK.up;
    return { pos: [s.x, y, s.z], look: [s.x + dx * 120, y - 40, s.z + dz * 120], fov: PEAK.fov };
  }
  const a = i * 1.3 + 0.6 + u * 0.9; // round the focal point, slowly
  return { pos: [s.x + Math.sin(a) * ISO.dist, ground + ISO.dist * ISO.rise, s.z + Math.cos(a) * ISO.dist], look: [s.x, ground + 2, s.z], fov: ISO.fov };
}

/** The camera `t` seconds into the tour, looping. */
export function tourShot(level: Level | ParkLevel, stops: Stop[], t: number): Shot {
  const n = stops.length, k = Math.floor(t / STOP_SECONDS), i = ((k % n) + n) % n, u = (t - k * STOP_SECONDS) / STOP_SECONDS;
  const here = hover(level, stops[i]!, i, u), w = smooth((u - (1 - FLIGHT)) / FLIGHT);
  const next = w > 0 ? hover(level, stops[(i + 1) % n]!, (i + 1) % n, 0) : here;
  const pos = here.pos.map((v, j) => mix(v, next.pos[j]!, w)) as Shot["pos"];
  pos[1] = Math.max(pos[1], level.height(pos[0], pos[2]) + CLEAR); // a flight up a hill follows the ground
  return { pos, look: here.look.map((v, j) => mix(v, next.look[j]!, w)) as Shot["look"], fov: mix(here.fov, next.fov, w) };
}
