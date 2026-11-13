// The safe paths at night. Each night a few of a region's campfires, its cabins and its arena are the safe houses, joined by
// a few winding paths that solar lights come up along at dusk: dim, just enough to keep your feet and see the edges.
// On a path, by a lit fire or at a house, nothing touches you. Off them, something starts to stalk you, and it catches
// you in ten seconds far out in the dark or thirty close to the lights. Which fires and which paths change every
// night, from the night's number and the region, so a party's night is the same for everyone (the world clock is shared).
// No three.js and no DOM: view.ts draws the lights and runs the stalk, the tests walk the paths.
import { clamp, lerp, mulberry32 } from "@rustybuns/util";
import { REGIONS } from "../regions.ts";
import { DAWN_HOUR, DAY } from "./nature.ts";
import { POIS } from "./poi.ts";
import { WORLD } from "./trail.ts";
import { arenaOf, dry } from "./world.ts";

export const HOUSES = 8;          // campfires that are safe houses tonight, besides the arena
export const PATH_HALF = 4;       // metres either side of a path's line that are safe
export const HOUSE_R = 24;        // a house keeps this much round it safe (a lit fire's light, poi.ts SHELTER_R)
export const LIGHT_STEP = 12;     // metres between the solar lights down each side of a path
const PT_STEP = 8;                // metres between a path's points
const DRY_REACH = 80;             // a point in water steps this far either side, at most, to find dry ground
export const CATCH_FAR = 10, CATCH_NEAR = 30; // seconds until something catches you, far out and close to safety
const FAR = 150;                  // this far from safety, it is as quick as it gets
const DRAIN = 5;                  // seconds back on a path for the stalk to fade from full

export interface House { id: string; x: number; z: number }
export interface Path { from: string; to: string; pts: [number, number][] }
export interface Night { n: number; night: number; houses: House[]; paths: Path[] }

/** Which night it is `t` seconds into the walk: the count turns over at noon, so one night never changes at midnight. */
export const nightOf = (t: number) => Math.floor(t / DAY + (DAWN_HOUR - 12) / 24);

const cache = new Map<string, Night>();
/** Region n's safe houses and paths on night `night`: the arena, its cabins (every night) and HOUSES of its fires, joined by the shortest tree. */
export function safePaths(n: number, night: number): Night {
  const key = `${n}:${night}`, hit = cache.get(key);
  if (hit) return hit;
  const g = REGIONS.find((r) => r.n === n), r = mulberry32((n * 7919 + night * 104729) >>> 0);
  const fires = (POIS.get(n) ?? []).filter((p) => p.kind === "fire").map((p) => ({ id: p.id, x: p.x, z: p.z, k: r() }));
  fires.sort((a, b) => a.k - b.k);
  const cabins = (POIS.get(n) ?? []).filter((p) => p.kind === "cabin").map(({ id, x, z }) => ({ id, x, z }));
  const houses: House[] = [...(g ? [{ id: `arena:${n}`, ...arenaOf(g) }] : []), ...cabins, ...fires.slice(0, HOUSES).map(({ id, x, z }) => ({ id, x, z }))];
  // Prim's tree: every house reached by the cheapest new path, so a night has houses - 1 paths and no loops. A metre of
  // open water costs WET times a dry one, so the tree walks round a bay rather than across it when land joins the two.
  const paths: Path[] = [], inTree = houses.slice(0, 1), out = houses.slice(1);
  while (out.length) {
    let best = { a: inTree[0]!, i: 0, d: Infinity };
    for (const a of inTree) out.forEach((b, i) => { const d = cost(a, b); if (d < best.d) best = { a, i, d }; });
    const b = out.splice(best.i, 1)[0]!;
    inTree.push(b);
    paths.push({ from: best.a.id, to: b.id, pts: wind(best.a, b, r()) });
  }
  const out2 = { n, night, houses, paths };
  if (cache.size > 64) cache.clear();
  cache.set(key, out2);
  return out2;
}

const WET = 6;
const costs = new Map<string, number>(); // houses don't move, so a pair costs the same every night
/** What a path from a to b costs: its length, with every metre over the sea or a river WET times dearer. */
function cost(a: House, b: House): number {
  const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`, hit = costs.get(key);
  if (hit !== undefined) return hit;
  const d = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(1, Math.ceil(d / (PT_STEP * 2)));
  let wet = 0;
  for (let i = 1; i < steps; i++) if (!dry(WORLD, lerp(a.x, b.x, i / steps), lerp(a.z, b.z, i / steps))) wet++;
  const c = d * (1 + ((WET - 1) * wet) / steps);
  costs.set(key, c);
  return c;
}

/** A path from a to b that wanders a little either side of the straight line, never at its ends, and steps aside onto dry ground round rivers and the sea's edge. */
function wind(a: House, b: House, seed: number): [number, number][] {
  const d = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(1, Math.ceil(d / PT_STEP)), nx = -(b.z - a.z) / (d || 1), nz = (b.x - a.x) / (d || 1);
  const amp = Math.min(40, d * 0.06), f1 = 1 + Math.floor(seed * 3), ph = seed * 6.283;
  return Array.from({ length: steps + 1 }, (_, i): [number, number] => {
    const u = i / steps, off = amp * Math.sin(Math.PI * u) * Math.sin(f1 * Math.PI * u + ph);
    const x = lerp(a.x, b.x, u) + nx * off, z = lerp(a.z, b.z, u) + nz * off;
    if (i === 0 || i === steps || dry(WORLD, x, z)) return [x, z];
    // In water: the nearest dry spot to either side across the path's line (the side it already wanders to first).
    const side = off >= 0 ? 1 : -1;
    for (let k = 4; k <= DRY_REACH; k += 4) for (const sg of [side, -side]) {
      const px = x + nx * k * sg, pz = z + nz * k * sg;
      if (dry(WORLD, px, pz)) return [px, pz];
    }
    return [x, z]; // nowhere dry near: a ford it is
  });
}

/** Metres from (x, z) to the nearest safe ground: a path's line or a house's ring; 0 when you're on it. */
export function toSafety(nt: Night, x: number, z: number): number {
  let best = Infinity;
  for (const h of nt.houses) best = Math.min(best, Math.hypot(h.x - x, h.z - z) - HOUSE_R);
  for (const p of nt.paths) for (let i = 1; i < p.pts.length; i++) best = Math.min(best, segDist(p.pts[i - 1]!, p.pts[i]!, x, z) - PATH_HALF);
  return Math.max(0, best);
}
function segDist([ax, az]: [number, number], [bx, bz]: [number, number], x: number, z: number) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz, t = L ? clamp(((x - ax) * dx + (z - az) * dz) / L, 0, 1) : 0;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

/** Seconds until something catches you this far from safety: thirty at the edge of the lights, ten far out. */
export const catchSeconds = (d: number) => lerp(CATCH_NEAR, CATCH_FAR, clamp(d / FAR, 0, 1));

/** The stalk, 0 (nothing) to 1 (caught), after `dt` seconds this far from safety: it builds off the paths and fades on them. */
export const stalk = (s: number, dt: number, d: number) => clamp(d > 0 ? s + dt / catchSeconds(d) : s - dt / DRAIN, 0, 1);

/** The solar lights near (x, z): one down each side of every path every LIGHT_STEP metres, within `radius`. */
export function lightsNear(nt: Night, x: number, z: number, radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (const p of nt.paths) {
    let run = 0;
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, az] = p.pts[i - 1]!, [bx, bz] = p.pts[i]!, L = Math.hypot(bx - ax, bz - az);
      if (Math.hypot(ax - x, az - z) > radius + L) { run += L; continue; }
      const nx = -(bz - az) / (L || 1), nz = (bx - ax) / (L || 1);
      for (let s = (LIGHT_STEP - (run % LIGHT_STEP)) % LIGHT_STEP; s < L; s += LIGHT_STEP) {
        const px = ax + ((bx - ax) * s) / L, pz = az + ((bz - az) * s) / L;
        if (Math.hypot(px - x, pz - z) > radius) continue;
        const e = PATH_HALF - 0.5; // just inside the safe edge, so a light is always on safe ground
        out.push([px + nx * e, pz + nz * e], [px - nx * e, pz - nz * e]);
      }
      run += L;
    }
  }
  return out;
}
