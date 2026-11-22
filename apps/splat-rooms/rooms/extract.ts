// Spike for #3269: a scanned room plus a labels.json (a named box per object) in, each object's splats cut out
// as their own piece, and a check that the round planner still plans on the result. Also a way to make the
// labels worse on purpose (moved, resized, dropped boxes), to see what a vision model's rough boxes would cost
// before paying for one. Pure: no Blender, no GPU, no network.
import type { RawSplats } from "../../splat-spray/src/levels/ply.ts";
import type { SceneDetail, SceneObject } from "../src/actions/scenes.ts";
import { planRound, type Candidate } from "../src/game/round.ts";
import type { Obb } from "../src/viewer/boxes.ts";
import { ROW } from "./pack.ts";

/** True when point (x, y, z) sits inside the box, grown by `pad` metres on every side. */
export function insideObb(x: number, y: number, z: number, b: Obb, pad = 0): boolean {
  const dx = x - b.center[0], dy = y - b.center[1], dz = z - b.center[2];
  for (let a = 0; a < 3; a++) {
    const ax = b.axes[a]!;
    if (Math.abs(dx * ax[0] + dy * ax[1] + dz * ax[2]) > Math.max(b.half[a]!, 0.01) + pad) return false;
  }
  return true;
}

/** Each splat goes to the smallest candidate box holding it (a mug on a table is the mug). */
export function cutObjects(raw: RawSplats, objects: Candidate[]): Map<string, number[]> {
  const order = [...objects].sort((p, q) => p.obb.volume - q.obb.volume);
  // a loose axis-aligned bound first, so most splats skip the box test
  const aabb = order.map((c) => {
    const r = [0, 1, 2].map((i) => Math.abs(c.obb.axes[0][i]!) * c.obb.half[0] + Math.abs(c.obb.axes[1][i]!) * c.obb.half[1] +
      Math.abs(c.obb.axes[2][i]!) * c.obb.half[2] + 0.01);
    return [0, 1, 2].flatMap((i) => [c.obb.center[i]! - r[i]!, c.obb.center[i]! + r[i]!]);
  });
  const out = new Map<string, number[]>(order.map((c) => [c.ins_id, []]));
  for (let i = 0; i < raw.count; i++) {
    const x = raw.pos[i * 3]!, y = raw.pos[i * 3 + 1]!, z = raw.pos[i * 3 + 2]!;
    for (let k = 0; k < order.length; k++) {
      const b = aabb[k]!;
      if (x < b[0]! || x > b[1]! || y < b[2]! || y > b[3]! || z < b[4]! || z > b[5]!) continue;
      if (insideObb(x, y, z, order[k]!.obb)) { out.get(order[k]!.ins_id)!.push(i); break; }
    }
  }
  return out;
}

/** The chosen splats as pack.ts rows, ready for packPly: one object as its own file. */
export function toRows(raw: RawSplats, idx: number[]): Float32Array {
  const rows = new Float32Array(idx.length * ROW);
  idx.forEach((i, k) => {
    const q = raw.quat;
    rows.set([raw.pos[i * 3]!, raw.pos[i * 3 + 1]!, raw.pos[i * 3 + 2]!, raw.scale[i * 3]!, raw.scale[i * 3 + 1]!, raw.scale[i * 3 + 2]!,
      q[i * 4 + 3]!, q[i * 4]!, q[i * 4 + 1]!, q[i * 4 + 2]!, raw.color[i * 3]!, raw.color[i * 3 + 1]!, raw.color[i * 3 + 2]!, raw.opacity[i]!], k * ROW);
  });
  return rows;
}

/** Splats shared by two cuts over splats in either: 1 is the same cut, 0 is nothing in common. */
export function iou(a: number[], b: number[]): number {
  if (!a.length && !b.length) return 1;
  const s = new Set(a);
  let both = 0;
  for (const i of b) if (s.has(i)) both++;
  return both / (a.length + b.length - both);
}

export interface Rough {
  /** most a box centre moves, metres */
  shift: number;
  /** most a box grows or shrinks, as a fraction (0.2 = up to 20%) */
  scale: number;
  /** share of objects the "model" misses entirely */
  drop: number;
}

/** Labels made worse on purpose, the way a model's boxes from photos might be: moved, resized, some missing. */
export function roughen(objects: SceneObject[], rough: Rough, rand: () => number): SceneObject[] {
  const out: SceneObject[] = [];
  for (const o of objects) {
    if (!o.bounding_box || o.bounding_box.length < 8) { out.push(o); continue; }
    if (rand() < rough.drop) continue;
    const c = o.bounding_box;
    const mid = { x: 0, y: 0, z: 0 };
    for (const p of c) { mid.x += p.x / c.length; mid.y += p.y / c.length; mid.z += p.z / c.length; }
    const k = 1 + (rand() * 2 - 1) * rough.scale;
    const ang = rand() * Math.PI * 2, d = rand() * rough.shift;
    const move = { x: Math.cos(ang) * d, y: Math.sin(ang) * d, z: (rand() * 2 - 1) * d * 0.3 };
    out.push({ ...o, bounding_box: c.map((p) => ({
      x: mid.x + (p.x - mid.x) * k + move.x, y: mid.y + (p.y - mid.y) * k + move.y, z: mid.z + (p.z - mid.z) * k + move.z,
    })) });
  }
  return out;
}

/** How many of `rounds` seeded rounds the planner can build, and how many different targets they use. */
export function roundCheck(scene: Pick<SceneDetail, "objects" | "structure">, rounds = 20): { planned: number; targets: number } {
  const seen = new Set<string>();
  let planned = 0;
  for (let s = 1; s <= rounds; s++) {
    const r = planRound(scene, { seed: s });
    if (r) { planned++; seen.add(r.target.ins_id); }
  }
  return { planned, targets: seen.size };
}

