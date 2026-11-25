// The three cameras over one scene, and boxes as faces to paint. Pure math, no canvas: tests run it.
//
//   2d    straight down, orthographic: a flat map
//   2.5d  the isometric angle, orthographic: a city you pan
//   3d    perspective, orbits: drag to turn, wheel to come closer
//
// Camera space: x right, `up` up the screen, `depth` toward the viewer (bigger is nearer).
import type { Dim } from "./layout.ts";

export interface Cam { yaw: number; pitch: number; persp: boolean; dist: number; zoom: number; panX: number; panY: number; cx: number; cz: number }
export type Pt = [number, number];

const ISO = Math.atan(1 / Math.SQRT2);
export const camFor = (dim: Dim, cx: number, cz: number, span: number): Cam => ({
  yaw: dim === "2d" ? 0 : Math.PI / 4,
  pitch: dim === "2d" ? Math.PI / 2 : dim === "2.5d" ? ISO : 0.62,
  persp: dim === "3d", dist: Math.max(12, span * 1.6), zoom: 1, panX: 0, panY: 0, cx, cz,
});

/** The world point in camera space: [x, up, depth]. */
export function view(c: Cam, x: number, y: number, z: number): [number, number, number] {
  const px = x - c.cx, pz = z - c.cz, sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), sp = Math.sin(c.pitch), cp = Math.cos(c.pitch);
  const x1 = px * cy - pz * sy, z1 = px * sy + pz * cy;
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

/** Where the perspective camera sits in the world (for which faces it can see). */
export function eye(c: Cam): [number, number, number] {
  const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), sp = Math.sin(c.pitch), cp = Math.cos(c.pitch);
  return [c.cx + sy * cp * c.dist, sp * c.dist, c.cz + cy * cp * c.dist];
}

/** World -> screen pixels in a `w` x `h` view, with the pixels per world unit `scale` gives. Null behind the camera. */
export function project(c: Cam, w: number, h: number, scale: number, x: number, y: number, z: number): { p: Pt; depth: number } | null {
  const [vx, up, depth] = view(c, x, y, z);
  const f = c.persp ? c.dist / (c.dist - depth) : 1;
  if (c.persp && c.dist - depth < 0.5) return null;
  const s = scale * c.zoom * f;
  return { p: [w / 2 + c.panX + vx * s, h / 2 + c.panY - up * s], depth };
}

export type FaceName = "top" | "bottom" | "east" | "west" | "south" | "north";
export interface Face { name: FaceName; pts: Pt[]; shade: number }
export interface BoxLike { x: number; z: number; w: number; d: number; h: number }

const NORMALS: Record<FaceName, [number, number, number]> = { top: [0, 1, 0], bottom: [0, -1, 0], east: [1, 0, 0], west: [-1, 0, 0], south: [0, 0, 1], north: [0, 0, -1] };
/** Light from up and a little left-front: the top brightest, sides apart from each other. */
const LIGHT = (() => { const v = [-0.4, 1, 0.55]; const n = Math.hypot(...v); return v.map((a) => a / n); })();

/** A box's faces the camera can see, each with its four corners on screen and how lit it is (0..1). */
export function boxFaces(c: Cam, w: number, h: number, scale: number, b: BoxLike): Face[] {
  const [x0, x1, z0, z1, y1] = [b.x, b.x + b.w, b.z, b.z + b.d, b.h];
  const corners: Record<FaceName, [number, number, number][]> = {
    top: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
    bottom: [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]],
    east: [[x1, 0, z0], [x1, y1, z0], [x1, y1, z1], [x1, 0, z1]],
    west: [[x0, 0, z0], [x0, y1, z0], [x0, y1, z1], [x0, 0, z1]],
    south: [[x0, 0, z1], [x1, 0, z1], [x1, y1, z1], [x0, y1, z1]],
    north: [[x0, 0, z0], [x1, 0, z0], [x1, y1, z0], [x0, y1, z0]],
  };
  const e = eye(c), mid = [b.x + b.w / 2, b.h / 2, b.z + b.d / 2];
  // Orthographic: every ray is parallel, so a face shows when it turns toward the view direction, wherever it sits.
  const toward = [Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)];
  const out: Face[] = [];
  for (const name of Object.keys(corners) as FaceName[]) {
    const n = NORMALS[name];
    const at = [mid[0]! + n[0] * b.w / 2, mid[1]! + n[1] * b.h / 2, mid[2]! + n[2] * b.d / 2];
    const v = c.persp ? [e[0] - at[0]!, e[1] - at[1]!, e[2] - at[2]!] : toward;
    if (n[0] * v[0]! + n[1] * v[1]! + n[2] * v[2]! <= 1e-6) continue;
    const pts: Pt[] = [];
    for (const [x, y, z] of corners[name]) { const q = project(c, w, h, scale, x, y, z); if (!q) break; pts.push(q.p); }
    if (pts.length < 4) continue;
    const lit = n[0] * LIGHT[0]! + n[1] * LIGHT[1]! + n[2] * LIGHT[2]!;
    out.push({ name, pts, shade: 0.55 + 0.45 * Math.max(0, lit) });
  }
  return out;
}

/** The pixels per world unit that fit `w`x`d` of ground (and up to `tall` of height) in the view, with a margin. */
export function fitScale(c: Cam, vw: number, vh: number, w: number, d: number, tall: number): number {
  const pts: Pt[] = [];
  for (const x of [0, w]) for (const z of [0, d]) for (const y of [0, tall]) { const q = project({ ...c, zoom: 1, panX: 0, panY: 0 }, 0, 0, 1, x, y, z); if (q) pts.push(q.p); }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const ew = Math.max(1e-3, Math.max(...xs) - Math.min(...xs)), eh = Math.max(1e-3, Math.max(...ys) - Math.min(...ys));
  return 0.86 * Math.min(vw / ew, vh / eh);
}

/** Whether `p` is inside the polygon `poly`. */
export function inside(p: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
