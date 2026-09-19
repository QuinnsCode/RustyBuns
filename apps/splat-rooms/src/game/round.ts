// Round setup, reversed: pick the target first, then find a place to stand that
// can actually see it, then face it off-centre. Every round is then solvable by
// construction instead of hoping something good happens to be in view.
//
// This is all geometry over labels.json + structure.json, so it runs (and is
// tested) without a GPU.
import { toObb, rayObb, type Obb, type Vec3 } from "../viewer/boxes.ts";
import type { SceneDetail, SceneObject } from "../actions/scenes.ts";

const STRUCTURAL = new Set([
  "wall", "floor", "ceiling", "window", "door", "downlights", "Spotlight",
  "Linear lamp", "Track Light", "central air-conditioning", "curtain", "carpet",
]);

export interface Candidate { ins_id: string; label: string; obb: Obb }

export interface Round {
  target: Candidate;
  /** eye position in data space (z-up metres) */
  eye: Vec3;
  /** where to look, degrees, data space */
  yaw: number;
  pitch: number;
  /** metres from eye to target */
  distance: number;
  /** everything visible from `eye`: the pick-mode pool and wrong-guess feedback */
  visible: Candidate[];
  blockers: Obb[];
}

export const EYE_HEIGHT = 1.5;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Objects worth hunting: hand-to-furniture sized, not architecture. */
export function candidates(objects: SceneObject[]): Candidate[] {
  const out: Candidate[] = [];
  for (const o of objects) {
    if (!o.bounding_box || STRUCTURAL.has(o.label)) continue;
    const obb = toObb(o.bounding_box);
    if (!obb) continue;
    const longest = Math.max(...obb.size);
    if (longest < 0.06 || longest > 2.2) continue;
    out.push({ ins_id: o.ins_id, label: o.label, obb });
  }
  return out;
}

/** Walls as thin boxes, so line of sight respects them. */
export function wallObbs(scene: Pick<SceneDetail, "structure">): Obb[] {
  const walls = (scene.structure?.walls ?? []) as { thickness?: number; height?: number; location: number[][] }[];
  const out: Obb[] = [];
  for (const w of walls) {
    const [[x0, y0], [x1, y1]] = w.location as [number[], number[]];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const t = (w.thickness ?? 0.2) / 2;
    const h = w.height ?? 3;
    out.push({
      center: [(x0 + x1) / 2, (y0 + y1) / 2, h / 2],
      axes: [[ux, uy, 0], [-uy, ux, 0], [0, 0, 1]],
      half: [len / 2, t, h / 2],
      size: [len, t * 2, h],
      volume: len * t * 2 * h,
      corners: [],
    });
  }
  return out;
}

/** True when nothing stands between `from` and the centre of `c`. */
export function canSee(from: Vec3, c: Candidate, blockers: Obb[]): boolean {
  const d = sub(c.obb.center, from);
  const dist = Math.hypot(...d);
  const dir = norm(d);
  for (const b of blockers) {
    const t = rayObb(from, dir, b);
    // Only counts as blocking if it sits meaningfully in front of the target.
    if (t !== null && t < dist - 0.25) return false;
  }
  return true;
}

/** Deterministic PRNG: a scene plus a seed always gives the same round. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; };
}

function inPolygon(p: [number, number], poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Standing spots: inside the room outline, not inside the furniture. */
export function standingSpots(scene: Pick<SceneDetail, "structure">, all: Candidate[], step = 0.5): Vec3[] {
  // Prefer the real room outline; without structure.json, fall back to the
  // footprint of the objects themselves so labels-only scenes still play.
  const poly = scene.structure?.rooms?.[0]?.profile?.length
    ? scene.structure!.rooms![0].profile
    : objectFootprint(all);
  if (!poly?.length) return [];
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const solid = all.filter((c) => c.obb.size[2] > 0.35);   // things you'd walk into
  const spots: Vec3[] = [];
  for (let x = Math.min(...xs) + step; x < Math.max(...xs); x += step) {
    for (let y = Math.min(...ys) + step; y < Math.max(...ys); y += step) {
      if (!inPolygon([x, y], poly)) continue;
      const p: Vec3 = [x, y, EYE_HEIGHT];
      const clear = solid.every((c) => {
        const d = sub(p, c.obb.center);
        return Math.hypot(d[0], d[1]) > Math.max(c.obb.half[0], c.obb.half[1]) + 0.35;
      });
      if (clear) spots.push(p);
    }
  }
  return spots;
}

/** Axis-aligned footprint of every candidate, inset a little, as a polygon. */
function objectFootprint(all: Candidate[], inset = 0.4): number[][] | null {
  if (!all.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of all) {
    x0 = Math.min(x0, c.obb.center[0] - c.obb.half[0]);
    x1 = Math.max(x1, c.obb.center[0] + c.obb.half[0]);
    y0 = Math.min(y0, c.obb.center[1] - c.obb.half[1]);
    y1 = Math.max(y1, c.obb.center[1] + c.obb.half[1]);
  }
  if (!(x1 - x0 > inset * 2 && y1 - y0 > inset * 2)) return null;
  return [[x0 + inset, y0 + inset], [x1 - inset, y0 + inset], [x1 - inset, y1 - inset], [x0 + inset, y1 - inset]];
}

export interface PlanOptions {
  seed?: number;
  /** how far off centre the target sits, degrees */
  offset?: number;
  /** force a specific target */
  targetId?: string;
  /** ideal distance from the target, metres */
  idealDistance?: number;
}

/**
 * Build a round. With no `targetId`, prefers rare labels: "find the microwave"
 * is a game, "find a cup" is not when the room holds six hundred cups.
 */
export function planRound(scene: Pick<SceneDetail, "objects" | "structure">, opts: PlanOptions = {}): Round | null {
  const all = candidates(scene.objects);
  if (!all.length) return null;
  const rand = rng(opts.seed ?? 1);
  const ideal = opts.idealDistance ?? 4;

  const counts = new Map<string, number>();
  for (const c of all) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);

  const walls = wallObbs(scene);
  const spots = standingSpots(scene, all);
  if (!spots.length) return null;

  const order = opts.targetId
    ? all.filter((c) => c.ins_id === opts.targetId)
    : [...all]
        .filter((c) => (counts.get(c.label) ?? 0) <= 3)
        .map((c) => ({ c, k: rand() }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.c);
  if (!order.length) return null;

  for (const target of order) {
    const others = all.filter((c) => c.ins_id !== target.ins_id && c.obb.volume > 0.02);
    const blockers = [...walls, ...others.map((c) => c.obb)];
    const ranked = spots
      .map((p) => ({ p, d: Math.hypot(p[0] - target.obb.center[0], p[1] - target.obb.center[1]) }))
      .filter((s) => s.d > 1.5 && s.d < 8)
      .sort((a, b) => Math.abs(a.d - ideal) - Math.abs(b.d - ideal));
    for (const { p, d } of ranked) {
      if (!canSee(p, target, blockers)) continue;
      const dir = sub(target.obb.center, p);
      const straightOn = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
      // Face near the target, not at it: in view, but off centre.
      const off = (opts.offset ?? 22) * (rand() < 0.5 ? -1 : 1);
      const pitch = (Math.atan2(dir[2], Math.hypot(dir[0], dir[1])) * 180) / Math.PI;
      const visible = all.filter((c) => canSee(p, c, blockers.filter((b) => b !== c.obb)));
      return { target, eye: p, yaw: straightOn + off, pitch, distance: d, visible, blockers };
    }
  }
  return null;
}
