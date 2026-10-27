// Rails and ledges set into the hillside: a long smooth bar that comes out of the slope, follows its contour,
// dips to the ground and climbs back out, or a steel-edged ledge cut along a bank. Unlike the kit, which is built
// on a floor at 0 and draped, each one is laid straight onto the finished ground (the heights are absolute), so the
// bar sits flush where the earth meets it and stands clear on a post only where the slope falls away.
import { mulberry32 } from "@rustybuns/util";
import type { Bounds, Rail, RailKind, Spawn } from "../level.ts";
import { CHAIN_STEP, part, type Part, POST_EVERY, smooth } from "./pieces.ts";
import { type Circle, footprint, lane } from "./scatter.ts";

type Ground = (x: number, z: number) => number;
export type EmbeddedKind = "contour" | "emerge" | "dip" | "bank";

/** How far a bar sits over the earth at its ends, so a rider can ollie onto it from the ground. */
const MOUTH = 0.35;
/** The nearest a bar comes to the earth along its run, and the furthest it stands from it before it needs a post. */
const FLUSH = 0.12, POSTED = 0.6, MAX_CLEAR = 1.3;

export type EmbeddedWorld = {
  bounds: Bounds; R: number; ground: Ground; spawns: Spawn[];
  lanes?: [{ x: number; z: number }, { x: number; z: number }][];
  /** What is already there: circles to keep clear of. */
  taken: Circle[];
};

/** One bar laid along a path on the ground: `heading` is the yaw it runs, `len` metres long. Null if the slope won't hold it. */
export function embeddedRail(ground: Ground, at: { x: number; z: number }, heading: number, kind: EmbeddedKind, len: number): Part | null {
  const n = Math.round(len / CHAIN_STEP), fx = Math.sin(heading), fz = Math.cos(heading), sway = kind === "contour" ? 1.6 : 0;
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n, d = (u - 0.5) * len, side = sway * Math.sin(u * Math.PI * 1.5);
    return { x: at.x + fx * d + fz * side, z: at.z + fz * d - fx * side, u };
  });
  const g = pts.map((p) => ground(p.x, p.z));
  // The bar's height over the earth: a bank keeps a ledge's height along the cut, a contour rides a hand over it, an
  // emerging bar leaves the hill at its start level while the ground falls away, a dip sinks to the earth mid-run.
  const wanted = pts.map((p, i) => {
    const mouth = MOUTH * (1 - smooth(Math.min(p.u, 1 - p.u) * 8)); // lifts off the ground at either end
    if (kind === "emerge") return g[0]! + MOUTH + (g[n]! + 1 - g[0]! - MOUTH) * p.u; // level out of the hill at the start, a metre clear of the ground by the far end
    if (kind === "dip") return g[i]! + FLUSH + (0.5 - FLUSH) * smooth(Math.abs(p.u - 0.5) * 3 - 0.2); // out of the ground's reach at either mouth, sunk to the earth mid-run
    return g[i]! + (kind === "bank" ? 0.4 : 0.3) + mouth;
  });
  let h = wanted;
  for (let pass = 0; pass < 6; pass++) h = h.map((v, i) => (i === 0 || i === n ? v : (h[i - 1]! + v + h[i + 1]!) / 3)); // a smooth line, not the ground's every bump
  for (let i = 0; i <= n; i++) {
    h[i] = Math.max(h[i]!, g[i]! + FLUSH);
    if (h[i]! - g[i]! > MAX_CLEAR) return null; // the ground fell too far away for a bar to stand there
  }
  for (let i = 1; i < n; i++) h[i] = (h[i - 1]! + h[i]! * 2 + h[i + 1]!) / 4; // the max above can leave a crease; round it
  for (let i = 0; i <= n; i++) h[i] = Math.max(h[i]!, g[i]! + FLUSH * 0.8);
  const slope = (i: number) => Math.abs(h[i + 1]! - h[i]!) / CHAIN_STEP;
  if (Array.from({ length: n }, (_, i) => slope(i)).some((s) => s > 0.55)) return null; // too steep to hold a grind
  const railKind: RailKind = kind === "bank" ? "ledge" : "rail";
  const rails: Rail[] = Array.from({ length: n }, (_, i) => ({
    kind: railKind, a: { x: pts[i]!.x, z: pts[i]!.z }, b: { x: pts[i + 1]!.x, z: pts[i + 1]!.z }, y: h[i]!, y2: h[i + 1]!, chain: true as const,
    ...(i > 0 && i % POST_EVERY === 0 && h[i]! - g[i]! > POSTED ? { post: true as const } : {}),
  }));
  return part({ rails });
}

/** The embedded bars of a park, a few long smooth ones, deterministic for a seed. */
export function embedded(world: EmbeddedWorld, o: { seed?: number; count?: number } = {}): Part[] {
  const { seed = 7, count = 4 } = o, r = mulberry32(seed), b = world.bounds, kinds: EmbeddedKind[] = ["contour", "dip", "bank", "emerge"];
  const taken = [...world.taken, ...(world.lanes ?? []).flatMap(lane), ...world.spawns.map((s) => ({ x: s.x, z: s.z, r: 16 }))], made: Part[] = [];
  for (let tries = 0; tries < 400 && made.length < count; tries++) {
    const kind = kinds[made.length % kinds.length]!, len = 24 + Math.floor(r() * 4) * 3;
    const at = { x: b.minX + 20 + r() * (b.maxX - b.minX - 40), z: b.minZ + 20 + r() * (b.maxZ - b.minZ - 40) };
    if (Math.hypot(at.x, at.z) > world.R * 0.9 - len / 2) continue;
    // the hillside's fall line here: the bar runs across it (a contour, a bank) or down it
    const e = 2, gx = (world.ground(at.x + e, at.z) - world.ground(at.x - e, at.z)) / (2 * e), gz = (world.ground(at.x, at.z + e) - world.ground(at.x, at.z - e)) / (2 * e), steep = Math.hypot(gx, gz);
    if (steep < (tries < 160 ? 0.06 : 0) || steep > 0.5) continue; // flat country gets its bars on the level once the slopes have had their turn
    const down = Math.atan2(-gx, -gz), heading = kind === "emerge" || kind === "dip" ? down : down + Math.PI / 2;
    const p = embeddedRail(world.ground, at, heading, kind, len);
    if (!p) continue;
    const fp = footprint(p).map((c) => ({ ...c, r: 3 }));
    if (fp.some((c) => c.x < b.minX + 6 || c.x > b.maxX - 6 || c.z < b.minZ + 6 || c.z > b.maxZ - 6 || taken.some((t) => Math.hypot(c.x - t.x, c.z - t.z) < c.r + t.r))) continue;
    made.push(p);
    taken.push(...fp);
  }
  return made;
}
