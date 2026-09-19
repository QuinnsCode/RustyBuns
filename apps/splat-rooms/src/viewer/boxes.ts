// InteriorGS boxes arrive as 8 corners, in the same z-up metre space as the
// splats. Corners 0-3 are the bottom face, 4-7 the top, in matching order, so
// an oriented box is (origin, three edge vectors) taken from corner 0.
import type { Corner } from "../actions/scenes.ts";

export type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.sqrt(dot(a, a));
const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export interface Obb {
  center: Vec3;
  /** unit axes */
  axes: [Vec3, Vec3, Vec3];
  /** half-extent along each axis */
  half: Vec3;
  size: Vec3;
  volume: number;
  corners: Vec3[];
}

export function toObb(box: Corner[]): Obb | null {
  if (!box || box.length < 8) return null;
  const c = box.map((p) => [p.x, p.y, p.z] as Vec3);
  const e0 = sub(c[1], c[0]), e1 = sub(c[3], c[0]), e2 = sub(c[4], c[0]);
  const size: Vec3 = [len(e0), len(e1), len(e2)];
  const axes: [Vec3, Vec3, Vec3] = [norm(e0), norm(e1), norm(e2)];
  // Degenerate boxes (a flat painting, a zero-thickness label) still need a
  // usable axis, so fall back to the world axis when an edge has no length.
  const fallback: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let i = 0; i < 3; i++) if (size[i] < 1e-6) axes[i] = fallback[i] as Vec3;
  const center = add(c[0], mul(add(add(e0, e1), e2), 0.5));
  return { center, axes, half: [size[0] / 2, size[1] / 2, size[2] / 2], size, volume: size[0] * size[1] * size[2], corners: c };
}

/** Ray vs oriented box in the same space. Returns distance along the ray, or null. */
export function rayObb(origin: Vec3, dir: Vec3, b: Obb): number | null {
  const d = sub(origin, b.center);
  let tMin = -Infinity, tMax = Infinity;
  for (let i = 0; i < 3; i++) {
    const axis = b.axes[i];
    const e = dot(axis, d);
    const f = dot(axis, dir);
    // Flat boxes get a small thickness so a painting on a wall is still clickable.
    const h = Math.max(b.half[i], 0.01);
    if (Math.abs(f) > 1e-9) {
      let t1 = (-e - h) / f, t2 = (-e + h) / f;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    } else if (-e - h > 0 || -e + h < 0) return null;
  }
  return tMin >= 0 ? tMin : tMax >= 0 ? tMax : null;
}

/** The 12 edges of a box, as line-segment endpoint pairs, for wireframe drawing. */
export const BOX_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
