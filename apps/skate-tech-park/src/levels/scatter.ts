// Fills a whole park with kit parts, the way a skate game scatters rails, ramps and boxes across its map:
// a jittered grid over the bounds, one seeded pick from the kit per cell, kept only where the ground is
// flat enough and nothing else is in the way. Hand-placed sites win; scatter fills what they leave empty.
import { mulberry32 } from "@rustybuns/util";
import type { Bounds, Spawn } from "../level.ts";
import { bowl, box, fallenLog, flatBar, funbox, handrail, hip, hubba, kicker, ledge, outcrop, type At, type Part, quarterPipe, rollers, spine, stairSet, tabletop } from "./pieces.ts";

export type Scatter = {
  /** Same seed, same park. */
  seed?: number;
  /** Metres between cells: one part lands in each. */
  cell?: number;
  /** Chance a cell gets a part (0..1). */
  fill?: number;
  /** Steepest ground (rise over run across a part's footprint) a part will be laid on. */
  slope?: number;
};

export const SCATTER: Required<Scatter> = { seed: 1, cell: 28, fill: 0.9, slope: 0.25 };

type Make = (at: At, r: () => number) => Part;
const pick = <T>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)]!;
const between = (r: () => number, a: number, b: number) => a + (b - a) * r();

/** The kit scatter draws from, each with a say in how big it comes out. */
const KIT: Make[] = [
  (at, r) => kicker(at, { w: between(r, 3, 5), h: between(r, 0.8, 1.6), curve: pick(r, [1, 2]) }),
  (at, r) => box(at, { w: between(r, 3, 6), d: between(r, 3, 6), h: between(r, 0.3, 0.7) }),
  (at, r) => flatBar(at, { len: between(r, 8, 16) }),
  (at, r) => handrail(at, { len: between(r, 8, 14), y: between(r, 0.7, 1.1) }),
  (at, r) => ledge(at, { len: between(r, 7, 12), h: between(r, 0.4, 0.7) }),
  (at, r) => funbox(at, { w: between(r, 6, 9), d: between(r, 14, 22), h: between(r, 0.7, 1.2), ramp: between(r, 4, 6) }),
  (at, r) => quarterPipe(at, { w: between(r, 8, 12), d: between(r, 4, 6), h: between(r, 2, 3.4) }),
  (at, r) => hip(at, { w: between(r, 6, 9), d: between(r, 6, 8), h: between(r, 1.2, 2) }),
  (at, r) => spine(at, { w: between(r, 8, 12), d: between(r, 5, 7), h: between(r, 1.6, 2.2) }),
  (at, r) => stairSet(at, { w: between(r, 5, 8), steps: Math.round(between(r, 4, 7)), rise: 0.25, run: 0.9 }),
  (at, r) => hubba(at, { steps: Math.round(between(r, 4, 7)), rise: 0.25, run: 0.9 }),
  (at, r) => tabletop(at, { w: between(r, 6, 8), d: between(r, 20, 26), h: between(r, 1.2, 1.8) }),
  (at, r) => rollers(at, { w: 8, n: Math.round(between(r, 3, 5)), period: 7, h: between(r, 0.5, 0.8) }),
  (at, r) => outcrop(at, { r: between(r, 2, 3.5), h: between(r, 1.2, 2.2) }),
  (at, r) => fallenLog(at, { len: between(r, 10, 16), r: between(r, 0.6, 0.9) }),
  (at, r) => bowl(at, { w: between(r, 24, 34), d: between(r, 18, 24), h: between(r, 2, 3) }),
];

export type Circle = { x: number; z: number; r: number };

/** A part as circles on the ground (a piece's footprint, points along each rail), so we can tell what it covers. */
export function footprint(p: Part): Circle[] {
  const out: Circle[] = p.pieces.map((q) => ({ x: q.x, z: q.z, r: Math.hypot(q.w, q.d) / 2 }));
  for (const rail of p.rails) {
    const len = Math.hypot(rail.b.x - rail.a.x, rail.b.z - rail.a.z), n = Math.max(1, Math.ceil(len / 6));
    for (let i = 0; i <= n; i++) out.push({ x: rail.a.x + ((rail.b.x - rail.a.x) * i) / n, z: rail.a.z + ((rail.b.z - rail.a.z) * i) / n, r: 2 });
  }
  return out;
}

export type ScatterWorld = {
  bounds: Bounds;
  /** Terrain radius: the ground is only real inside this disc. */
  R: number;
  ground: (x: number, z: number) => number;
  /** What is already there: hand-placed parts, trees, landmarks. Scatter keeps clear of every circle. */
  taken: Circle[];
  spawns: Spawn[];
  /** Lines to keep open: a gap from its launch to its landing, and the run-up to it from a spawn. */
  lanes?: [{ x: number; z: number }, { x: number; z: number }][];
};

/** The parts to add to a park, deterministic for a seed. Draping onto the ground is the caller's job. */
export function scatter(world: ScatterWorld, o: Scatter = {}): Part[] {
  const { seed, cell, fill, slope } = { ...SCATTER, ...o }, r = mulberry32(seed), b = world.bounds;
  const taken = [...world.taken, ...(world.lanes ?? []).flatMap(lane), ...world.spawns.map((s) => ({ x: s.x, z: s.z, r: 14 }))], made: Part[] = [];
  for (let x0 = b.minX; x0 + cell <= b.maxX; x0 += cell) for (let z0 = b.minZ; z0 + cell <= b.maxZ; z0 += cell) {
    const make = pick(r, KIT), at = { x: x0 + cell * between(r, 0.25, 0.75), z: z0 + cell * between(r, 0.25, 0.75), yaw: (Math.PI / 4) * Math.floor(r() * 8) };
    const part = make(at, r), roll = r(), fp = footprint(part), reach = Math.max(...fp.map((c) => Math.hypot(c.x - at.x, c.z - at.z) + c.r));
    if (roll > fill) continue;
    if (at.x - reach < b.minX + 4 || at.x + reach > b.maxX - 4 || at.z - reach < b.minZ + 4 || at.z + reach > b.maxZ - 4) continue;
    if (Math.hypot(at.x, at.z) + reach > world.R * 0.95) continue;
    if (!level(world.ground, at, reach, slope)) continue;
    if (fp.some((c) => taken.some((t) => Math.hypot(c.x - t.x, c.z - t.z) < c.r + t.r + 5))) continue;
    made.push(part);
    taken.push(...fp);
  }
  return made;
}

/** Whether the ground under a footprint of radius `reach` is nearly level: the rise across it is small for its width. */
function level(ground: (x: number, z: number) => number, at: At, reach: number, slope: number) {
  const hs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ground(at.x + dx! * reach, at.z + dz! * reach));
  return Math.max(...hs) - Math.min(...hs) <= slope * 2 * reach;
}

/** Circles laid along a line, close enough that nothing fits between them. */
export function lane([a, b]: [{ x: number; z: number }, { x: number; z: number }]): Circle[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n, r: 5 }));
}
