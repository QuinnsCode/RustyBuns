// Earthworks: the skate park cut into the ground itself. A national park is mostly open land, so instead of
// only standing kit on it, we dig bowls into the meadow, pile dirt jumps, roll a pump track and cut spillway
// channels, then lay them across the whole map. Each work is a shape held at the height of the ground at its
// centre (a shelf, like a pad), blended back into the hillside over a skirt. The result is one heightfield, so
// the sim, the camera, the mesh and the map all see it without knowing it is there.
import { mulberry32 } from "@rustybuns/util";
import { type Terrain } from "@rustybuns/terrain";
import type { Rail } from "../level.ts";
import { arc, clamp01, part, smooth, type At, type Part } from "./pieces.ts";
import { lane, type ScatterWorld } from "./scatter.ts";

/** What a work is laid in: poured concrete, or packed dirt. */
export type Surface = "concrete" | "hardpack";
export type WorkKind = "bowl" | "pool" | "pump" | "spillway" | "jumps" | "earthQuarter" | "mound" | "kidney" | "keyhole" | "terraced";

export type Earthwork = {
  kind: WorkKind; surface: Surface;
  x: number; z: number; yaw: number;
  /** Footprint (a rounded rectangle) and how far its corners are rounded. */
  w: number; d: number; cr: number;
  /** Metres it takes to blend back into the hillside beyond the footprint. */
  skirt: number;
  /** The height it is held at: the ground under its centre. */
  y0: number;
  /** Height relative to `y0` at a point in the work's own frame (+x across, +z along). */
  shape: (lx: number, lz: number) => number;
  /** 0..1 along the lip where the coping stone runs. */
  coping: (lx: number, lz: number) => number;
  /** Reach of the whole thing, skirt included. */
  reach: number;
  rails: Rail[];
};

const SKIN = 0.06;
const inFrame = (e: { x: number; z: number; yaw: number }, x: number, z: number): [number, number] => {
  const dx = x - e.x, dz = z - e.z, c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
};
/** Signed distance to a rounded rectangle: negative inside. */
const sdf = (lx: number, lz: number, w: number, d: number, cr: number) => {
  const qx = Math.abs(lx) - (w / 2 - cr), qz = Math.abs(lz) - (d / 2 - cr);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - cr;
};
/** A wall's curve from the floor (0) to the lip (1): a quarter pipe, stopped short of vertical so a board can ride it. */
const wall = (t: number) => arc(0.92 * clamp01(t)) / arc(0.92);
/** Closeness to a lip: 1 on it, fading to 0 a coping-width away. */
const edge = (e: number, width = 1.6) => 1 - smooth(Math.abs(e) / width);

type Make = (at: At, r: () => number, y0: number) => Earthwork;

const work = (kind: WorkKind, surface: Surface, at: At, y0: number, o: { w: number; d: number; cr?: number; skirt?: number; shape: Earthwork["shape"]; coping?: Earthwork["coping"]; rails?: (e: Earthwork) => Rail[] }): Earthwork => {
  const e: Earthwork = { kind, surface, x: at.x, z: at.z, yaw: at.yaw ?? 0, w: o.w, d: o.d, cr: o.cr ?? 0, skirt: o.skirt ?? 9, y0, shape: o.shape, coping: o.coping ?? (() => 0), reach: Math.hypot(o.w, o.d) / 2 + (o.skirt ?? 9), rails: [] };
  e.rails = o.rails?.(e) ?? [];
  return e;
};
/** A coping rail along the world line between two local points. */
const lip = (e: Earthwork, ax: number, az: number, bx: number, bz: number): Rail => {
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw), at = (lx: number, lz: number) => ({ x: e.x + lx * c + lz * s, z: e.z - lx * s + lz * c });
  return { kind: "coping", a: at(ax, az), b: at(bx, bz), y: SKIN };
};

/** A pit dug to depth `h`: `inner` says how many metres in from the lip a point is (negative on the deck round it), and the wall curves down over `1.4 h`. */
const dug = (kind: WorkKind, at: At, y0: number, o: { w: number; d: number; cr: number; h: number; inner: (lx: number, lz: number) => number; rails?: (e: Earthwork) => Rail[] }) => {
  const trans = o.h * 1.4;
  return work(kind, "concrete", at, y0, {
    w: o.w, d: o.d, cr: o.cr, skirt: 10,
    shape: (lx, lz) => { const e = o.inner(lx, lz); return e <= 0 ? 0 : -o.h + o.h * wall(1 - e / trans); },
    coping: (lx, lz) => edge(o.inner(lx, lz)),
    rails: o.rails,
  });
};

/** A bowl dug into the meadow: a deck all round, then walls curving down to a flat floor. */
export const bowl = (at: At, y0: number, o: { w?: number; d?: number; h?: number; deck?: number; cr?: number } = {}): Earthwork => {
  const { w = 30, d = 22, h = 2.6, deck = 3, cr = 7 } = o, ir = Math.max(1, cr - deck);
  return dug("bowl", at, y0, {
    w, d, cr, h, inner: (lx, lz) => -sdf(lx, lz, w - 2 * deck, d - 2 * deck, ir),
    rails: (e) => { const x = w / 2 - deck - ir, z = d / 2 - deck - ir, X = w / 2 - deck, Z = d / 2 - deck; return [lip(e, -x, -Z, x, -Z), lip(e, X, -z, X, z), lip(e, x, Z, -x, Z), lip(e, -X, z, -X, -z)]; },
  });
};

/** Two round pools run together, a big lobe and a small one: the kidney of a classic backyard pool. Lobes meet in a pinch to carve through. */
export const kidney = (at: At, y0: number, o: { r1?: number; r2?: number; h?: number; deck?: number } = {}): Earthwork => {
  const { r1 = 12, r2 = 8, h = 2.6, deck = 3 } = o, c = (r1 + r2) * 0.55, R = Math.max(r1, r2);
  const lobes: [number, number][] = [[-c * (r2 / (r1 + r2)) * 2, r1], [c * (r1 / (r1 + r2)) * 2, r2]];
  return dug("kidney", at, y0, { w: 2 * (c + R), d: 2 * R, cr: R, h, inner: (lx, lz) => Math.max(...lobes.map(([cx, r]) => r - deck - Math.hypot(lx - cx, lz))) });
};

/** A round pool with a square-ended bay off one side, the keyhole in its plan: a cradle at one end, a bowl at the other. */
export const keyhole = (at: At, y0: number, o: { r?: number; bay?: number; w?: number; h?: number; deck?: number } = {}): Earthwork => {
  const { r = 10, bay = 14, w = 14, h = 2.8, deck = 3 } = o, d = 2 * r + bay, cz = -d / 2 + r, len = d / 2 - cz;
  return dug("keyhole", at, y0, {
    w: Math.max(2 * r, w), d, cr: 4, h,
    inner: (lx, lz) => Math.max(r - deck - Math.hypot(lx, lz - cz), -sdf(lx, lz - (cz + d / 2) / 2, w - 2 * deck, len - 2 * deck, 2)),
  });
};

/** A pit stepped down in three terraces, each with a lip you can grind and a ramp to the next: drop in a level at a time. */
export const terraced = (at: At, y0: number, o: { w?: number; d?: number; h?: number; run?: number; deck?: number } = {}): Earthwork => {
  const { w = 40, d = 32, h = 3.6, run = 7, deck = 3 } = o, levels = 3, ramp = 3.2, step = h / levels;
  const inner = (lx: number, lz: number) => -sdf(lx, lz, w - 2 * deck, d - 2 * deck, 3);
  return work("terraced", "concrete", at, y0, {
    w, d, cr: 4, skirt: 10,
    shape: (lx, lz) => { const e = inner(lx, lz); let down = 0; for (let k = 0; k < levels; k++) down += step * smooth((e - k * run) / ramp); return -down; },
    coping: (lx, lz) => { const e = inner(lx, lz); return Math.max(...Array.from({ length: levels }, (_, k) => edge(e - k * run))); },
    rails: (e) => Array.from({ length: levels }, (_, k) => {
      const x = w / 2 - deck - k * run - 3, z = d / 2 - deck - k * run;
      return x > 2 && z > 2 ? [lip(e, -x, -z, x, -z), lip(e, -x, z, x, z)] : [];
    }).flat(),
  });
};

/** A round pool: the same cut, with no corners. */
export const pool = (at: At, y0: number, o: { r?: number; h?: number; deck?: number } = {}): Earthwork => {
  const { r = 13, h = 2.4, deck = 3 } = o;
  return { ...bowl(at, y0, { w: 2 * r, d: 2 * r, h, deck, cr: r }), kind: "pool", rails: [] };
};

/** A row of rollers to pump along, on packed dirt: a strip whose bumps swell and fade at the ends. */
export const pump = (at: At, y0: number, o: { n?: number; period?: number; h?: number; w?: number } = {}): Earthwork => {
  const { n = 6, period = 8, h = 0.9, w = 10 } = o, d = n * period + 8;
  return work("pump", "hardpack", at, y0, {
    w, d, cr: w / 2, skirt: 6,
    shape: (lx, lz) => {
      const s = lz + d / 2 - 4;
      if (s < 0 || s > d - 8) return 0;
      return (h / 2) * (1 - Math.cos((2 * Math.PI * s) / period)) * clamp01((1 - Math.abs(lx) / (w / 2)) * 3) * smooth(Math.min(s, d - 8 - s) / period);
    },
  });
};

/** A channel cut along the hillside with a wall each side, open at both ends: a creek bed with the water left out. */
export const spillway = (at: At, y0: number, o: { w?: number; d?: number; h?: number; deck?: number } = {}): Earthwork => {
  const { w = 18, d = 56, h = 2.4, deck = 2.5 } = o, trans = h * 1.4, inner = (lx: number) => w / 2 - deck - Math.abs(lx);
  const depth = (lz: number) => h * smooth(Math.min(lz + d / 2, d / 2 - lz) / 14);
  return work("spillway", "concrete", at, y0, {
    w, d, cr: 0, skirt: 9,
    shape: (lx, lz) => { const e = inner(lx), dp = depth(lz); return e <= 0 ? 0 : -dp + dp * wall(1 - e / trans); },
    coping: (lx) => edge(inner(lx)),
    rails: (e) => [lip(e, -(w / 2 - deck), -d / 2 + 14, -(w / 2 - deck), d / 2 - 14), lip(e, w / 2 - deck, -d / 2 + 14, w / 2 - deck, d / 2 - 14)],
  });
};

/** Dirt jumps in a row: each a rising face, a flat top, a steep landing and the trough between. */
export const jumps = (at: At, y0: number, o: { n?: number; period?: number; h?: number; w?: number } = {}): Earthwork => {
  const { n = 4, period = 18, h = 1.8, w = 9 } = o, d = n * period + 10;
  return work("jumps", "hardpack", at, y0, {
    w, d, cr: w / 2, skirt: 7,
    shape: (lx, lz) => {
      const s = lz + d / 2 - 5, u = (((s % period) + period) % period) / period;
      if (s < 0 || s > n * period) return 0;
      const lump = u < 0.5 ? (u / 0.5) ** 1.7 : u < 0.62 ? 1 : u < 0.72 ? 1 - smooth((u - 0.62) / 0.1) : 0;
      return h * lump * clamp01((1 - Math.abs(lx) / (w / 2)) * 3.5);
    },
  });
};

/** A pile of earth with a quarter pipe on one face and a flat deck on top: a transition to launch off and drop in from. */
export const earthQuarter = (at: At, y0: number, o: { w?: number; d?: number; h?: number; face?: number } = {}): Earthwork => {
  const { w = 16, d = 20, h = 3.4, face = 7 } = o;
  return work("earthQuarter", "concrete", at, y0, {
    w, d, cr: 3, skirt: 10,
    shape: (lx, lz) => { const s = lz + d / 2; return h * (s < face ? wall(s / face) : 1) * smooth((w / 2 - Math.abs(lx)) / 3); },
    coping: (_, lz) => edge(lz + d / 2 - face),
    rails: (e) => [lip(e, -w / 2 + 3, -d / 2 + face, w / 2 - 3, -d / 2 + face)],
  });
};

/** A raised platform with a ramp each end: a funbox of earth. */
export const mound = (at: At, y0: number, o: { w?: number; d?: number; h?: number; ramp?: number } = {}): Earthwork => {
  const { w = 14, d = 30, h = 1.5, ramp = 8 } = o;
  return work("mound", "concrete", at, y0, {
    w, d, cr: 3, skirt: 8,
    shape: (lx, lz) => h * smooth(Math.min(lz + d / 2, d / 2 - lz) / ramp) * smooth((w / 2 - Math.abs(lx)) / 3),
    coping: (_, lz) => Math.max(edge(lz + d / 2 - ramp), edge(d / 2 - ramp - lz)),
  });
};

const between = (r: () => number, a: number, b: number) => a + (b - a) * r();
const pick = <T>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)]!;

/** What gets cut, and how big it comes out. Bowls and pumps repeat most, since a park is mostly those. */
const KIT: Make[] = [
  (at, r, y) => bowl(at, y, { w: between(r, 26, 38), d: between(r, 20, 28), h: between(r, 2.2, 3.2) }),
  (at, r, y) => bowl(at, y, { w: between(r, 24, 32), d: between(r, 24, 32), h: between(r, 2, 2.8), cr: 12 }),
  (at, r, y) => pool(at, y, { r: between(r, 11, 16), h: between(r, 2, 3) }),
  (at, r, y) => pump(at, y, { n: Math.round(between(r, 5, 8)), h: between(r, 0.7, 1.1) }),
  (at, r, y) => spillway(at, y, { w: between(r, 16, 22), d: between(r, 44, 70), h: between(r, 2, 3) }),
  (at, r, y) => jumps(at, y, { n: Math.round(between(r, 3, 5)), h: between(r, 1.4, 2.2) }),
  (at, r, y) => earthQuarter(at, y, { w: between(r, 14, 20), h: between(r, 3, 4.4) }),
  (at, r, y) => mound(at, y, { w: between(r, 12, 18), d: between(r, 26, 36), h: between(r, 1.2, 1.9) }),
  // into the earth: deep, steep and odd-shaped
  (at, r, y) => kidney(at, y, { r1: between(r, 10, 14), r2: between(r, 6, 9), h: between(r, 2.2, 3.2) }),
  (at, r, y) => keyhole(at, y, { r: between(r, 8, 11), bay: between(r, 10, 16), w: between(r, 12, 16), h: between(r, 2.4, 3.4) }),
  (at, r, y) => terraced(at, y, { w: between(r, 36, 44), d: between(r, 28, 36) }),
  (at, r, y) => bowl(at, y, { w: between(r, 22, 28), d: between(r, 22, 28), h: between(r, 4, 5), cr: 10 }), // a deep vert bowl
  (at, r, y) => pool(at, y, { r: between(r, 6, 8), h: between(r, 3.4, 4.4) }), // a cradle
  (at, r, y) => spillway(at, y, { w: between(r, 12, 15), d: between(r, 50, 70), h: between(r, 3.8, 5) }), // a storm drain
  // the small ones fit where the big ones don't
  (at, r, y) => pool(at, y, { r: between(r, 7, 9), h: between(r, 1.6, 2.2) }),
  (at, r, y) => bowl(at, y, { w: between(r, 16, 20), d: between(r, 14, 18), h: between(r, 1.6, 2.2), cr: 5 }),
  (at, r, y) => pump(at, y, { n: 3, h: 0.8, w: 8 }),
  (at, r, y) => earthQuarter(at, y, { w: between(r, 10, 12), d: 14, h: between(r, 2.2, 3), face: 5 }),
  (at, r, y) => mound(at, y, { w: 10, d: between(r, 18, 22), h: 1.1, ramp: 6 }),
];

export type Works = { cell?: number; fill?: number; slope?: number; seed?: number };
export const WORKS: Required<Works> = { cell: 30, fill: 0.95, slope: 0.2, seed: 5 };

/** An earthwork as circles on the ground, skirt included: a long one is a line of them, so a pump track doesn't hide a whole cell. */
export function circles(e: Earthwork) {
  const long = Math.max(e.w, e.d), short = Math.min(e.w, e.d), n = Math.max(1, Math.ceil(long / short)), c = Math.cos(e.yaw), s = Math.sin(e.yaw), along = e.d >= e.w ? [s, c] : [c, -s];
  return Array.from({ length: n }, (_, i) => { const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (long - short); return { x: e.x + along[0]! * t, z: e.z + along[1]! * t, r: short / 2 + e.skirt }; });
}

/** Where the earthworks go: one per cell of a jittered grid over the whole bounds, on ground gentle enough to cut, clear of everything already there. */
export function layOut(world: ScatterWorld, o: Works = {}): Earthwork[] {
  const { cell, fill, slope, seed } = { ...WORKS, ...o }, r = mulberry32(seed), b = world.bounds;
  const taken = [...world.taken, ...(world.lanes ?? []).flatMap(lane), ...world.spawns.map((s) => ({ x: s.x, z: s.z, r: 16 }))], made: Earthwork[] = [];
  for (let x0 = b.minX; x0 + cell <= b.maxX; x0 += cell) for (let z0 = b.minZ; z0 + cell <= b.maxZ; z0 += cell) {
    if (r() > fill) continue;
    // a cell tries a few spots and kits before giving up, so a crowded meadow still gets the smaller things
    for (let tries = 0; tries < 10; tries++) {
      const at = { x: x0 + cell * between(r, 0.2, 0.8), z: z0 + cell * between(r, 0.2, 0.8), yaw: (Math.PI / 4) * Math.floor(r() * 8) };
      const e = pick(r, KIT)(at, r, world.ground(at.x, at.z)), reach = e.reach;
      const inside = reach - e.skirt + 2; // the skirt may run past the bounds; the work itself may not
      if (at.x - inside < b.minX || at.x + inside > b.maxX || at.z - inside < b.minZ || at.z + inside > b.maxZ) continue;
      if (Math.hypot(at.x, at.z) + reach > world.R * 0.95) continue;
      const half = Math.sqrt(e.w * e.d) / 2, hs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].map(([dx, dz]) => world.ground(at.x + dx! * half, at.z + dz! * half));
      if (Math.max(...hs) - Math.min(...hs) > slope * 2 * half) continue;
      const line = circles(e);
      if (line.some((k) => taken.some((t) => Math.hypot(k.x - t.x, k.z - t.z) < k.r + t.r))) continue;
      made.push(e);
      taken.push(...line);
      break;
    }
  }
  return made;
}

/** The ground with the earthworks cut into it. */
export function sculpt(t: Terrain, works: Earthwork[]): Terrain {
  if (!works.length) return t;
  return {
    ...t,
    height(x, z) {
      let h = t.height(x, z);
      for (const e of works) {
        if (Math.abs(x - e.x) > e.reach || Math.abs(z - e.z) > e.reach) continue;
        const [lx, lz] = inFrame(e, x, z), dist = sdf(lx, lz, e.w, e.d, e.cr);
        if (dist >= e.skirt) continue;
        h += (dist <= 0 ? 1 : 1 - smooth(dist / e.skirt)) * (e.y0 + e.shape(lx, lz) - h);
      }
      return h;
    },
  };
}

/** What a point on the ground is made of, for painting it: concrete or packed dirt (or neither), how strongly, and the coping stone along a lip. */
export type Paint = { surface: Surface | null; k: number; coping: number };
const BARE: Paint = { surface: null, k: 0, coping: 0 };

export function paintAt(works: Earthwork[], x: number, z: number): Paint {
  for (const e of works) {
    if (Math.abs(x - e.x) > e.reach || Math.abs(z - e.z) > e.reach) continue;
    const [lx, lz] = inFrame(e, x, z), dist = sdf(lx, lz, e.w, e.d, e.cr);
    if (dist < 1.5) return { surface: e.surface, k: 1 - smooth(Math.max(0, dist) / 1.5), coping: e.coping(lx, lz) };
  }
  return BARE;
}

/** The coping rails of every work, at skin height above the floor (the caller drapes them). */
export const copings = (works: Earthwork[]): Part => part({ rails: works.flatMap((e) => e.rails) });
