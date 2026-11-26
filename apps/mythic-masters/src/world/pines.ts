// The Pine Barrens' own landmarks (region 1, the story bible's pine-barrens wants, #5622): Batsto Village by its
// trail section (k=0), Atsion Lake's cedar water ringed by white cedar (k=2), the steel fire tower on Apple Pie Hill
// (k=4), and the cranberry bogs in rows behind low dykes and sluice gates (k=6); and along the trail, which the ground
// draws as a white sugar-sand road there, two wheel ruts and puddles the colour of tea. Each sight is laid near its section's keeper stone on the flattest dry ground that keeps clear of the
// trail, the stones and the region's other places (the tower takes the highest instead), the same every time.
// No three.js and no DOM: pines-view.ts draws them, flora.ts keeps the trees out of their clearings, the tests walk to them.
import { POIS } from "./poi.ts";
import { dry, heightAt, ownerAt } from "./world.ts";
import { TRAILS, WORLD, type Pt } from "./trail.ts";

export const PINE_N = 1;
/** Metres kept clear round a keeper's stone (poi.ts NO_STONE) and either side of the trail. */
const STONE_GAP = 30, TRAIL_GAP = 8, PLACE_GAP = 14;

export type PartKind = "mansion" | "tower" | "mill" | "gristmill" | "cottage" | "lake" | "bog" | "vines" | "dyke" | "sluice" | "firetower" | "shed" | "beach" | "dock" | "cedar" | "pitch" | "sedge";
/** One built thing: its centre, which way it faces (radians about y), and its footprint, metres (w along its own x). */
export interface Part { kind: PartKind; x: number; z: number; yaw: number; w: number; d: number }
export interface Sight { id: "batsto" | "atsion" | "fire-tower" | "bogs"; name: string; k: number; x: number; z: number; yaw: number; r: number; parts: Part[] }

const hash = (a: number, b: number) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Metres from (x, z) to a polyline. */
export function lineDist(pts: readonly Pt[], x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!, dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L));
    best = Math.min(best, Math.hypot(x - a.x - dx * u, z - a.z - dz * u));
  }
  return best;
}

/** The spot for a sight `r` metres across near stone k: dry, region 1's, clear of the trail, stones and places, and the
 *  flattest (or, `high`, the highest of the nearly flat). Undefined when no spot round the stone will do. */
function site(k: number, r: number, high: boolean): Pt | undefined {
  const tr = TRAILS.get(PINE_N);
  if (!tr) return undefined;
  const s = tr.stones[k]!, places = POIS.get(PINE_N) ?? [];
  let best: Pt | undefined, score = Infinity;
  for (const d of [r + 40, r + 70, r + 110, r + 160]) for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2, x = s.x + Math.cos(ang) * d, z = s.z + Math.sin(ang) * d;
    if (lineDist(tr.pts, x, z) < r + TRAIL_GAP || tr.stones.some((t) => Math.hypot(t.x - x, t.z - z) < r + STONE_GAP)) continue;
    if (places.some((p) => Math.hypot(p.x - x, p.z - z) < r + PLACE_GAP)) continue;
    let lo = Infinity, hi = -Infinity, ok = true;
    for (let i = 0; i < 9 && ok; i++) {
      const q = i === 0 ? { x, z } : { x: x + Math.cos(i * 0.785) * r, z: z + Math.sin(i * 0.785) * r };
      if (ownerAt(q.x, q.z) !== PINE_N || !dry(WORLD, q.x, q.z, 0.8)) ok = false;
      const y = heightAt(WORLD, q.x, q.z); lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    if (!ok) continue;
    const sc = (hi - lo) - (high ? heightAt(WORLD, x, z) * 0.6 : 0) + d * 0.004;
    if (sc < score) { score = sc; best = { x: Math.round(x), z: Math.round(z) }; }
  }
  return best;
}

/** `parts` laid out round (0, 0) facing +z, stood at p and turned to yaw. */
function stand(p: Pt, yaw: number, parts: Omit<Part, "yaw">[], turn = 0): Part[] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return parts.map((q) => ({ ...q, x: p.x + q.x * c + q.z * s, z: p.z - q.x * s + q.z * c, yaw: yaw + turn }));
}
/** Which way a sight faces: toward the trail, so its fronts are what you see walking by. */
function faceTrail(p: Pt): number {
  const tr = TRAILS.get(PINE_N)!;
  let near = tr.pts[0]!, d = Infinity;
  for (let i = 0; i + 1 < tr.pts.length; i++) for (let u = 0; u <= 1; u += 0.05) {
    const a = tr.pts[i]!, b = tr.pts[i + 1]!, q = { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }, e = Math.hypot(q.x - p.x, q.z - p.z);
    if (e < d) { d = e; near = q; }
  }
  return Math.atan2(near.x - p.x, near.z - p.z);
}

function batsto(): Sight | undefined {
  const p = site(0, 46, false);
  if (!p) return undefined;
  const yaw = faceTrail(p);
  // The mansion at the back with its tower, the mills to one side, the cottages in a row along the lake's shore.
  const parts: Omit<Part, "yaw">[] = [
    { kind: "lake", x: 30, z: 6, w: 34, d: 40 },
    { kind: "mansion", x: -22, z: -22, w: 16, d: 11 },
    { kind: "tower", x: -22, z: -15, w: 4.4, d: 4.4 },
    { kind: "gristmill", x: 6, z: -30, w: 9, d: 7 },
    { kind: "mill", x: 26, z: -24, w: 14, d: 7 },
    ...[0, 1, 2, 3, 4].map((i) => ({ kind: "cottage" as const, x: -36 + i * 9, z: 14, w: 6, d: 5 })),
  ];
  return { id: "batsto", name: "Batsto Village", k: 0, x: p.x, z: p.z, yaw, r: 46, parts: stand(p, yaw, parts) };
}

function atsion(): Sight | undefined {
  const p = site(2, 50, false);
  if (!p) return undefined;
  const yaw = faceTrail(p);
  // A tea-dark lake, a sand beach on the near shore with a dock out from it, and Atlantic white cedar standing dark and
  // close all round the far shore, the way it grows in the wet ground along every Pine Barrens stream.
  const parts: Omit<Part, "yaw">[] = [{ kind: "lake", x: 0, z: -6, w: 70, d: 52 }, { kind: "beach", x: 0, z: 22, w: 34, d: 7 }, { kind: "dock", x: 9, z: 14, w: 2.2, d: 14 }];
  for (let i = 0; i < 26; i++) {
    // round the shore from one end of the beach to the other the long way, two deep in places
    const a = Math.PI * (0.62 + 1.76 * (i / 25)) + (hash(i, 41) - 0.5) * 0.08, back = 3 + 5 * hash(i, 42), wide = 1.3 + 0.6 * hash(i, 44);
    parts.push({ kind: "cedar", x: Math.sin(a) * (35 + back), z: -6 + Math.cos(a) * (26 + back), w: wide, d: wide });
  }
  // Behind the cedars, the skyline the far shore really has (across the water, none on the beach side): short, crooked pitch pines with open, flat-topped crowns,
  // between and over the cedars rather than a row of spires.
  for (let i = 0; i < 18; i++) {
    const a = Math.PI * (0.7 + 0.6 * (i / 17)) + (hash(i, 61) - 0.5) * 0.06, back = 7 + 10 * hash(i, 62), wide = 4 + 3 * hash(i, 63);
    parts.push({ kind: "pitch", x: Math.sin(a) * (35 + back), z: -6 + Math.cos(a) * (26 + back), w: wide, d: wide });
  }
  // Sedge in tussocks along the waterline, all the way round but the beach: half in the water, half on the bank.
  for (let i = 0; i < 110; i++) {
    const a = Math.PI * (0.58 + 1.84 * (i / 109)) + (hash(i, 51) - 0.5) * 0.05, k = 0.96 + 0.09 * hash(i, 52), wide = 1.2 + 1.4 * hash(i, 53);
    parts.push({ kind: "sedge", x: Math.sin(a) * 35 * k, z: -6 + Math.cos(a) * 26 * k, w: wide, d: wide });
  }
  return { id: "atsion", name: "Atsion Lake", k: 2, x: p.x, z: p.z, yaw, r: 50, parts: stand(p, yaw, parts) };
}

function fireTower(): Sight | undefined {
  const p = site(4, 9, true);
  if (!p) return undefined;
  const yaw = faceTrail(p);
  return { id: "fire-tower", name: "Apple Pie Hill fire tower", k: 4, x: p.x, z: p.z, yaw, r: 9, parts: stand(p, yaw, [{ kind: "firetower", x: 0, z: 0, w: 6, d: 6 }, { kind: "shed", x: 6.5, z: 3, w: 3, d: 2.4 }]) };
}

function bogs(): Sight | undefined {
  const p = site(6, 44, false);
  if (!p) return undefined;
  const yaw = faceTrail(p);
  // Six beds in two rows, a dyke round each, a sluice gate at the head of each, and a pump shed at the end. The near
  // row is flooded red for the harvest; the far row is still vines, bronze-green.
  const W = 12, D = 30, parts: Omit<Part, "yaw">[] = [];
  for (let row = 0; row < 2; row++) for (let i = 0; i < 3; i++) {
    const x = (i - 1) * (W + 3), z = row === 0 ? 10 : -22;
    parts.push({ kind: row === 0 ? "bog" : "vines", x, z, w: W, d: D }, { kind: "dyke", x, z, w: W + 2.4, d: D + 2.4 }, { kind: "sluice", x, z: z + D / 2 + 1.6, w: 2.2, d: 1.2 });
  }
  parts.push({ kind: "shed", x: 24, z: -6, w: 5, d: 4 });
  return { id: "bogs", name: "Cranberry bogs", k: 6, x: p.x, z: p.z, yaw, r: 44, parts: stand(p, yaw, parts) };
}

/** The Pine Barrens' landmarks: Batsto, Atsion Lake, the fire tower, the bogs (any whose ground won't take it is left out). */
export const SIGHTS: Sight[] = [batsto(), atsion(), fireTower(), bogs()].filter((s): s is Sight => !!s);

/** Inside one of the sights' clearings at (x, z)? Where no tree grows (flora.ts). */
export function cleared(x: number, z: number) {
  for (const s of SIGHTS) { const dx = x - s.x, dz = z - s.z, r = s.r + 6; if (dx * dx + dz * dz < r * r) return true; }
  return false;
}

/** Inside a building's walls (or a dyke's bank) at (x, z), so you walk round them, not through. The bog beds and lake
 *  don't count: their dykes and shore keep you out. */
const SOLID: ReadonlySet<PartKind> = new Set(["mansion", "tower", "mill", "gristmill", "cottage", "shed", "sluice"]);
export function inBuilding(x: number, z: number, body = 0.4) {
  for (const s of SIGHTS) {
    if (Math.abs(x - s.x) > s.r + 4 || Math.abs(z - s.z) > s.r + 4) continue;
    for (const p of s.parts) {
      if (!SOLID.has(p.kind)) continue;
      const c = Math.cos(p.yaw), sn = Math.sin(p.yaw), dx = x - p.x, dz = z - p.z, lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      if (Math.abs(lx) < p.w / 2 + body && Math.abs(lz) < p.d / 2 + body) return true;
    }
  }
  return false;
}

/** A puddle on the sand road: where, and how wide (metres). */
export interface Puddle { x: number; z: number; r: number; yaw: number }
/** Tea-coloured puddles along the Pine Barrens trail: one in every few 18-metre steps, in a wheel rut either side. */
export const PUDDLES: Puddle[] = (() => {
  const tr = TRAILS.get(PINE_N), out: Puddle[] = [];
  if (!tr) return out;
  for (let i = 0; i + 1 < tr.pts.length; i++) {
    const a = tr.pts[i]!, b = tr.pts[i + 1]!, L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / (L || 1), uz = (b.z - a.z) / (L || 1);
    for (let s = 6, j = 0; s < L - 6; s += 18, j++) {
      if (hash(i * 977 + j, 31) > 0.38) continue;
      const side = hash(i, j * 13 + 5) < 0.5 ? -1 : 1, off = side * (0.9 + 0.5 * hash(j, i + 7)), x = a.x + ux * s - uz * off, z = a.z + uz * s + ux * off;
      if (ownerAt(x, z) !== PINE_N || !dry(WORLD, x, z, 0.5) || tr.stones.some((t) => Math.hypot(t.x - x, t.z - z) < 10)) continue;
      out.push({ x, z, r: 0.7 + 1.1 * hash(j + 3, i + 11), yaw: Math.atan2(ux, uz) });
    }
  }
  return out;
})();

/** A stretch of wheel rut in the sand road: its middle, which way it runs, and how long it is (metres). */
export interface Rut { x: number; z: number; yaw: number; len: number }
/** Metres from the road's crown to each wheel rut, and the length of one stretch. */
export const RUT_OFF = 1.15, RUT_LEN = 3;
/** The two wheel ruts down the Pine Barrens' sand road, stretch by stretch, broken where a keeper's stone stands. */
export const RUTS: Rut[] = (() => {
  const tr = TRAILS.get(PINE_N), out: Rut[] = [];
  if (!tr) return out;
  for (let i = 0; i + 1 < tr.pts.length; i++) {
    const a = tr.pts[i]!, b = tr.pts[i + 1]!, L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / (L || 1), uz = (b.z - a.z) / (L || 1);
    for (let s = RUT_LEN / 2; s < L; s += RUT_LEN * 0.9) for (const side of [-1, 1]) {
      // the ruts wander a little either side of true, as wheels do
      const off = side * (RUT_OFF + 0.12 * Math.sin(s * 0.05 + i)), x = a.x + ux * s - uz * off, z = a.z + uz * s + ux * off;
      if (ownerAt(x, z) !== PINE_N || !dry(WORLD, x, z, 0.5) || tr.stones.some((t) => Math.hypot(t.x - x, t.z - z) < 8)) continue;
      out.push({ x, z, yaw: Math.atan2(ux, uz), len: RUT_LEN });
    }
  }
  return out;
})();
