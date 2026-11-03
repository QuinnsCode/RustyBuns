// A captured room as a level. Any scan that comes with a labels.json (a named 3D box per object) and a
// splat-transform "compressed PLY" can be played: each splat inside a box is tagged with that object, which
// is the same thing the built room gets for free from generating it. So the same scan, pick and focus code
// runs on a real room, and a new room (or a player's own scan, once it is labelled) is a new folder, not new code.
import * as THREE from "three";
import type { SpyObject, SpyScene } from "./scene.ts";
import type { RawSplats } from "./ply.ts";

export { readPly, type RawSplats } from "./ply.ts";

export interface Corner { x: number; y: number; z: number }
export interface Label { ins_id: string; label: string; bounding_box?: Corner[] }

/** Walls, floors and fittings are the room, not things to find. */
export const STRUCTURAL = new Set([
  "wall", "floor", "ceiling", "window", "door", "downlights", "Spotlight",
  "Linear lamp", "Track Light", "central air-conditioning", "curtain", "carpet",
]);

interface Box { label: string; id: number; center: THREE.Vector3; axes: THREE.Vector3[]; half: number[]; volume: number; lo: number[]; hi: number[] }

/** InteriorGS boxes are 8 corners: 0-3 the bottom face, 4-7 the top, in matching order. */
function toBox(l: Label, id: number): Box | null {
  const b = l.bounding_box;
  if (!b || b.length < 8) return null;
  const c = b.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const e = [c[1]!.clone().sub(c[0]!), c[3]!.clone().sub(c[0]!), c[4]!.clone().sub(c[0]!)];
  const size = e.map((v) => v.length());
  const longest = Math.max(...size);
  if (longest < 0.06 || longest > 2.2) return null;
  const fallback = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const axes = e.map((v, i) => (size[i]! < 1e-6 ? fallback[i]! : v.clone().normalize()));
  const center = c[0]!.clone().add(e[0]!.clone().add(e[1]!).add(e[2]!).multiplyScalar(0.5));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of c) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, p.getComponent(a)); hi[a] = Math.max(hi[a]!, p.getComponent(a)); }
  // a flat thing (a painting) still needs a little depth to hold splats
  const half = size.map((s) => Math.max(s / 2, 0.02));
  return { label: l.label, id, center, axes, half, volume: half[0]! * half[1]! * half[2]!, lo, hi };
}

export interface CapturedOpts {
  /** most splats to keep: every splat inside an object, then the biggest and most opaque of the rest */
  budget?: number;
  /** objects further than this from the eye are left as scenery */
  reach?: number;
  /** a label that appears more often than this is too common to ask for */
  maxSame?: number;
}

/** Splats and labels in, a playable room out: y-up, objects first (one contiguous run each), scenery after. */
export function buildCaptured(raw: RawSplats, labels: Label[], opts: CapturedOpts = {}): SpyScene & { eye: THREE.Vector3 } {
  const budget = opts.budget ?? 400_000, reach = opts.reach ?? 6, maxSame = opts.maxSame ?? 3;
  const seen = new Map<string, number>();
  for (const l of labels) seen.set(l.label, (seen.get(l.label) ?? 0) + 1);
  const boxes: Box[] = [];
  for (const l of labels) {
    if (STRUCTURAL.has(l.label) || (seen.get(l.label) ?? 0) > maxSame) continue;
    const b = toBox(l, boxes.length);
    if (b) boxes.push(b);
  }
  // Stand where most of the things are: the middle of the boxes, eye height (z is up here).
  const mid = (a: number) => { const v = boxes.map((b) => b.center.getComponent(a)).sort((x, y) => x - y); return v[Math.floor(v.length / 2)] ?? 0; };
  const eyeData = new THREE.Vector3(mid(0), mid(1), 1.5);
  const near = boxes.filter((b) => Math.hypot(b.center.x - eyeData.x, b.center.y - eyeData.y) <= reach);

  // which object holds each splat: the smallest box that contains it
  const owner = new Int32Array(raw.count).fill(-1);
  const d = new THREE.Vector3();
  for (let i = 0; i < raw.count; i++) {
    const x = raw.pos[i * 3]!, y = raw.pos[i * 3 + 1]!, z = raw.pos[i * 3 + 2]!;
    let best = -1, bestVolume = Infinity;
    for (let b = 0; b < near.length; b++) {
      const o = near[b]!;
      if (x < o.lo[0]! || x > o.hi[0]! || y < o.lo[1]! || y > o.hi[1]! || z < o.lo[2]! || z > o.hi[2]!) continue;
      if (o.volume >= bestVolume) continue;
      d.set(x, y, z).sub(o.center);
      if (Math.abs(d.dot(o.axes[0]!)) <= o.half[0]! && Math.abs(d.dot(o.axes[1]!)) <= o.half[1]! && Math.abs(d.dot(o.axes[2]!)) <= o.half[2]!) { best = b; bestVolume = o.volume; }
    }
    owner[i] = best;
  }

  // Scenery thins to the budget by what each splat adds to the picture: opacity times footprint.
  const inside = owner.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
  const room = Math.max(0, budget - inside);
  const scenery: number[] = [];
  for (let i = 0; i < raw.count; i++) if (owner[i]! < 0) scenery.push(i);
  const score = (i: number) => {
    const x = raw.scale[i * 3]!, y = raw.scale[i * 3 + 1]!, z = raw.scale[i * 3 + 2]!;
    return raw.opacity[i]! * (x + y + z - Math.min(x, y, z));
  };
  if (scenery.length > room) scenery.sort((a, b) => score(b) - score(a)).length = room;
  scenery.sort((a, b) => a - b);

  const order: number[] = [], objects: SpyObject[] = [];
  const byOwner: number[][] = near.map(() => []);
  for (let i = 0; i < raw.count; i++) if (owner[i]! >= 0) byOwner[owner[i]!]!.push(i);
  near.forEach((box, b) => {
    if (!byOwner[b]!.length) return;
    const id = objects.length;
    objects.push({ id, name: box.label, aliases: [], first: order.length, count: byOwner[b]!.length, center: new THREE.Vector3(), radius: 0.1, origin: new THREE.Vector3() });
    for (const i of byOwner[b]!) order.push(i);
  });
  const objectEnd = order.length;
  for (const i of scenery) order.push(i);

  const n = order.length;
  const toY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const q = new THREE.Quaternion();
  const out: SpyScene & { eye: THREE.Vector3 } = {
    centers: new Float32Array(n * 3), locals: new Float32Array(n * 3), colors: new Float32Array(n * 3), sizes: new Float32Array(n),
    itemOf: new Int32Array(n).fill(-1), objects, count: n,
    scales: new Float32Array(n * 3), quats: new Float32Array(n * 4), opacities: new Float32Array(n),
    eye: new THREE.Vector3(eyeData.x, eyeData.z, -eyeData.y),
  };
  const lo = objects.map(() => new THREE.Vector3(Infinity, Infinity, Infinity)), hi = objects.map(() => new THREE.Vector3(-Infinity, -Infinity, -Infinity));
  let oi = 0;
  for (let j = 0; j < n; j++) {
    const i = order[j]!;
    // z-up to y-up: (x, y, z) -> (x, z, -y)
    const x = raw.pos[i * 3]!, y = raw.pos[i * 3 + 2]!, z = -raw.pos[i * 3 + 1]!;
    out.centers.set([x, y, z], j * 3);
    out.locals.set([x, y, z], j * 3);
    out.colors.set(raw.color.subarray(i * 3, i * 3 + 3), j * 3);
    out.scales!.set(raw.scale.subarray(i * 3, i * 3 + 3), j * 3);
    out.sizes[j] = (raw.scale[i * 3]! + raw.scale[i * 3 + 1]! + raw.scale[i * 3 + 2]!) / 3;
    q.set(raw.quat[i * 4]!, raw.quat[i * 4 + 1]!, raw.quat[i * 4 + 2]!, raw.quat[i * 4 + 3]!);
    q.premultiply(toY);
    out.quats!.set([q.x, q.y, q.z, q.w], j * 4);
    out.opacities![j] = raw.opacity[i]!;
    if (j < objectEnd) {
      while (objects[oi + 1] && objects[oi + 1]!.first <= j) oi++;
      const o = objects[oi]!;
      out.itemOf[j] = o.id;
      lo[o.id]!.min(new THREE.Vector3(x, y, z));
      hi[o.id]!.max(new THREE.Vector3(x, y, z));
    }
  }
  for (const o of objects) {
    o.center.addVectors(lo[o.id]!, hi[o.id]!).multiplyScalar(0.5);
    o.radius = Math.max(0.06, hi[o.id]!.clone().sub(lo[o.id]!).length() / 2);
  }
  return out;
}

/** A labels.json off the wire: keep the entries that have a name, drop the rest. */
export function readLabels(json: unknown): Label[] {
  if (!Array.isArray(json)) return [];
  const out: Label[] = [];
  for (const v of json) {
    if (typeof v !== "object" || v === null) continue;
    const { ins_id, label, bounding_box } = v as Record<string, unknown>;
    if (typeof label !== "string") continue;
    const corners: Corner[] = [];
    if (Array.isArray(bounding_box)) {
      for (const c of bounding_box) {
        if (typeof c !== "object" || c === null) continue;
        const { x, y, z } = c as Record<string, unknown>;
        if (typeof x === "number" && typeof y === "number" && typeof z === "number") corners.push({ x, y, z });
      }
    }
    out.push({ ins_id: String(ins_id ?? out.length), label, bounding_box: corners });
  }
  return out;
}

export interface LevelEntry { id: string; name: string }

/** The rooms on offer: /scenes/levels.json, written by `bun scripts/index-levels.ts`. */
export function readLevels(json: unknown): LevelEntry[] {
  if (!Array.isArray(json)) return [];
  const out: LevelEntry[] = [];
  for (const v of json) {
    if (typeof v !== "object" || v === null) continue;
    const { id, name } = v as Record<string, unknown>;
    if (typeof id === "string" && /^[\w.-]+$/.test(id)) out.push({ id, name: typeof name === "string" ? name : id });
  }
  return out;
}
