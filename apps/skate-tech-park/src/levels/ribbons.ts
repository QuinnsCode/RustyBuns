// Ribbons: kit that follows the land instead of standing on it. A contour is traced along the hillside
// at one height, a `Profile` (the cross-section: a berm, a cut bank, a channel, whoops) is extruded down it
// as a chain of short pieces, and `fillContours` lays a whole park's worth of them on the slopes the hand-placed
// sites leave empty. A profile is a recipe with a width and a height, so one berm becomes a low roller or a
// tall wall by molding it, and `add` / `waves` / `mirror` make new profiles out of old ones.
// Across a ribbon, local +x is downhill and -x uphill, so a profile reads the same on every slope.
import { mulberry32 } from "@rustybuns/util";
import type { Bounds, Rail, Spawn } from "../level.ts";
import { arc, clamp01, join, part, type Gap, type Part, shape, smooth } from "./pieces.ts";

export type Pt = { x: number; z: number };

/** A cross-section: `f(u, s)` is the height above the ground `u` metres across (+ downhill) and `s` metres along; `crests` are the copings. */
export type Profile = { name: string; w: number; h: number; f: (u: number, s: number) => number; crests: number[] };

/** Thin skin so a ribbon's edge sits just over the ground mesh, not in it. */
const SKIN = 0.05;

// A recipe takes a width and a height: molding is just calling it with other numbers.
/** A lip on the downhill edge, curving up like a quarter pipe and falling away behind: holds a line along the slope. */
export const berm = (w = 9, h = 1.8): Profile => {
  const crest = 0.8;
  return { name: "contour berm", w, h, crests: [(crest - 0.5) * w], f: (u) => { const t = u / w + 0.5; return t < crest ? h * arc(clamp01((t - 0.25) / (crest - 0.25))) : h * (1 - smooth((t - crest) / (1 - crest))); } };
};
/** The cut bank: the same wall on the uphill edge, a transition to ride up and turn on. */
export const cutBank = (w = 9, h = 1.8): Profile => mirror(berm(w, h), "contour cut bank");
/** A channel along the slope with a wall each side. */
export const channel = (w = 12, h = 1.6): Profile => add(berm(w, h), mirror(berm(w, h), ""), "contour channel");

/** The same profile turned across the ribbon, so its wall is on the other side. */
export const mirror = (p: Profile, name = p.name): Profile => ({ ...p, name, f: (u, s) => p.f(-u, s), crests: p.crests.map((c) => -c) });
/** Two profiles laid over each other, the higher showing. */
export const add = (a: Profile, b: Profile, name: string): Profile => ({ name, w: Math.max(a.w, b.w), h: Math.max(a.h, b.h), crests: [...a.crests, ...b.crests], f: (u, s) => Math.max(Math.abs(u) > a.w / 2 ? 0 : a.f(u, s), Math.abs(u) > b.w / 2 ? 0 : b.f(u, s)) });
/** The profile swelling and sagging every `period` metres along: whoops to pump along a berm. */
export const waves = (p: Profile, period = 14, depth = 0.6, name = `${p.name} whoops`): Profile => ({ ...p, name, f: (u, s) => p.f(u, s) * (1 - depth * 0.5 * (1 + Math.cos((2 * Math.PI * s) / period))) });
/** Whoops across the whole width: rollers laid along the slope. */
export const rollers = (w = 8, h = 0.9, period = 7): Profile => ({ name: "contour rollers", w, h, crests: [], f: (u, s) => (h / 2) * (1 - Math.cos((2 * Math.PI * s) / period)) * clamp01((1 - Math.abs(u) / (w / 2)) * 3) });

export const PROFILES: Record<string, () => Profile> = {
  berm: () => berm(), cutBank: () => cutBank(), channel: () => channel(), rollers: () => rollers(),
  whoopBerm: () => waves(berm(9, 2.2), 16), tallBank: () => cutBank(10, 3),
};

/** The height of the ground's slope at a point, and its steepest-descent direction. */
const grad = (g: (x: number, z: number) => number, x: number, z: number) => [(g(x + 1, z) - g(x - 1, z)) / 2, (g(x, z + 1) - g(x, z - 1)) / 2] as const;

/**
 * Walks along the contour through `from`, `len` metres each way, holding its height. Stops where the ground goes flat (a contour
 * is nothing there), too steep to ride, turns back on itself, or `stop` says so. Always in the direction whose +x is downhill.
 */
export function trace(ground: (x: number, z: number) => number, from: Pt, o: { len: number; step?: number; stop?: (p: Pt) => boolean }): Pt[] {
  const step = o.step ?? 3, y0 = ground(from.x, from.z);
  const walk = (dir: 1 | -1) => {
    const out: Pt[] = [];
    let { x, z } = from, hx = 0, hz = 0;
    for (let d = 0; d < o.len; d += step) {
      const [gx, gz] = grad(ground, x, z), m = Math.hypot(gx, gz);
      if (m < 0.04 || m > 0.9) break;
      const nx = (dir * gz) / m, nz = (-dir * gx) / m;
      if (out.length && nx * hx + nz * hz < 0.95) break; // a bend tighter than the ribbon is wide
      hx = nx; hz = nz;
      x += hx * step; z += hz * step;
      const [fx, fz] = grad(ground, x, z), fm = Math.max(0.04, Math.hypot(fx, fz)), e = ground(x, z) - y0; // back down onto the contour
      x -= (e / (fm * fm)) * fx; z -= (e / (fm * fm)) * fz;
      const p = { x, z };
      if (o.stop?.(p)) break;
      out.push(p);
    }
    return out;
  };
  return [...walk(-1).reverse(), from, ...walk(1)];
}

/** A profile extruded along a path: a chain of short pieces (a touch overlapped, so bends have no cracks) and a coping rail along each crest. Built on a floor at 0; park.ts drapes it. */
export function extrude(path: Pt[], p: Profile, o: { taper?: number } = {}): Part {
  const taper = o.taper ?? 8, parts: Part[] = [];
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
  const total = cum[cum.length - 1]!, ease = (s: number) => smooth(Math.min(s, total - s) / taper);
  const heading = (i: number) => Math.atan2(path[i + 1]!.x - path[i]!.x, path[i + 1]!.z - path[i]!.z);
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!, b = path[i + 1]!, len = cum[i + 1]! - cum[i]!, yaw = heading(i), mid = (cum[i]! + cum[i + 1]!) / 2, d = len * 1.3;
    const at = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw };
    const rails: Rail[] = [];
    for (const u of p.crests) { // a rail along each crest, from this point to the next, each turned to its own heading
      const na = (j: number) => ({ x: path[j]!.x + Math.cos(heading(Math.min(j, path.length - 2))) * u, z: path[j]!.z - Math.sin(heading(Math.min(j, path.length - 2))) * u });
      rails.push({ kind: "coping", a: na(i), b: na(i + 1), y: SKIN + p.f(u, mid) * ease(mid) });
    }
    parts.push(part({ pieces: [shape("ramp", p.name, at, p.w, d, (lx, lz) => SKIN + p.f(lx, mid + lz) * ease(mid + lz))], rails }));
  }
  return join(...parts);
}

export type Fill = { lines?: number; maxLen?: number; seed?: number; profiles?: string[] };

/** Keep-out circles for everything the hand-placed kit, spawns, trees and landmarks already hold. */
export type Keep = { x: number; z: number; r: number };

/**
 * Lays contour ribbons across the park: each takes a different height (spread over the ground the rider can reach), starts where
 * that height meets a slope worth riding and follows it both ways until something is in the way. Ribbons keep clear of each other.
 */
export function fillContours(ground: (x: number, z: number) => number, bounds: Bounds, keep: Keep[], f: Fill = {}): { part: Part; paths: { profile: string; path: Pt[] }[] } {
  const { lines = 6, maxLen = 150, seed = 7 } = f, rng = mulberry32(seed), names = f.profiles ?? Object.keys(PROFILES);
  const margin = 12, inside = (p: Pt) => p.x > bounds.minX + margin && p.x < bounds.maxX - margin && p.z > bounds.minZ + margin && p.z < bounds.maxZ - margin;
  const hit = (p: Pt, pad: number) => keep.some((k) => Math.hypot(p.x - k.x, p.z - k.z) < k.r + pad);
  const taken = new Set<string>(), cell = (p: Pt) => `${Math.round(p.x / 14)},${Math.round(p.z / 14)}`;
  // seeds: every rideable slope on a grid, by height
  const seeds: (Pt & { y: number })[] = [];
  for (let x = bounds.minX + margin; x < bounds.maxX - margin; x += 8) for (let z = bounds.minZ + margin; z < bounds.maxZ - margin; z += 8) {
    const [gx, gz] = grad(ground, x, z), m = Math.hypot(gx, gz);
    if (m > 0.1 && m < 0.55) seeds.push({ x, z, y: ground(x, z) });
  }
  const paths: { profile: string; path: Pt[] }[] = [], parts: Part[] = [];
  if (!seeds.length) return { part: part(), paths };
  const ys = seeds.map((s) => s.y).sort((a, b) => a - b);
  for (let k = 0, tries = 0; k < lines && tries < lines * 6; tries++) {
    const target = ys[Math.floor(((tries % lines) + 0.5) / lines * (ys.length - 1))]!; // spread over the heights, then retry the same band
    const pool = seeds.filter((s) => Math.abs(s.y - target) < 0.8 && !hit(s, 10) && !taken.has(cell(s)));
    if (!pool.length) continue;
    const s = pool[Math.floor(rng() * pool.length)]!;
    const path = trace(ground, s, { len: maxLen / 2, stop: (p) => !inside(p) || hit(p, 8) || taken.has(cell(p)) });
    if (path.length < 8) continue;
    const name = names[Math.floor(rng() * names.length)]!, profile = PROFILES[name]!();
    for (const p of path) for (const [dx, dz] of [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14]]) taken.add(cell({ x: p.x + dx!, z: p.z + dz! }));
    parts.push(extrude(path, profile));
    paths.push({ profile: profile.name, path });
    k++;
  }
  return { part: join(...parts), paths };
}

/** The keep-out circles of a park's hand-laid parts. */
export function keepOut(o: { pieces: { x: number; z: number; w: number; d: number }[]; spawns: Spawn[]; gaps: Gap[]; trees: { x: number; z: number; r: number }[]; pickups: Pt[]; landmarks: Pt[] }): Keep[] {
  const k: Keep[] = [];
  for (const p of o.pieces) k.push({ x: p.x, z: p.z, r: Math.hypot(p.w, p.d) / 2 });
  for (const s of o.spawns) k.push({ ...s, r: 14 });
  for (const g of o.gaps) for (let i = 0; i <= 8; i++) k.push({ x: g.a.x + ((g.b.x - g.a.x) * i) / 8, z: g.a.z + ((g.b.z - g.a.z) * i) / 8, r: g.r + 4 });
  for (const g of o.gaps) { // and the run-up: the spawn nearest a gap's launch, along the line it rides in on
    const sp = o.spawns.reduce((a, b) => (Math.hypot(b.x - g.a.x, b.z - g.a.z) < Math.hypot(a.x - g.a.x, a.z - g.a.z) ? b : a));
    for (let i = 0; i <= 12; i++) k.push({ x: sp.x + ((g.a.x - sp.x) * i) / 12, z: sp.z + ((g.a.z - sp.z) * i) / 12, r: 8 });
  }
  for (const t of o.trees) k.push({ ...t, r: t.r + 3 });
  for (const p of o.pickups) k.push({ ...p, r: 6 });
  for (const l of o.landmarks) k.push({ ...l, r: 25 });
  return k;
}
