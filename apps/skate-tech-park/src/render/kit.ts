// The kit modelled in Blender (blender/kit.py): a wooden ramp, a concrete stair and a concrete block, each
// a unit box that is fitted to a piece here. x and z run -0.5..0.5 across and along the piece and y runs 0
// (its pad) to 1 (its riding surface at that point), so the top is the piece's own height function, drape
// and all, and what you see is what you ride. The outer tenth of x and z and the top tenth of y keep a size
// in metres (`MARGIN`), so trim, nosings and bevels don't stretch with the piece. Colours come from the
// model's materials and are baked into vertex colours, so the kit still merges into the one pieces mesh.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Piece } from "../level.ts";

export const KIT_MODULES = ["ramp", "step", "block"] as const;
export const KIT_BUDGETS = ["hi", "mid", "low"] as const;
export type KitModule = (typeof KIT_MODULES)[number];
export type KitBudget = (typeof KIT_BUDGETS)[number];

/**
 * A module as flat arrays: unit positions, baked colours, and which vertices are the steel ground plate, with
 * the riding surface's colour for a plate that has risen off the ground.
 */
export type Module = { pos: Float32Array; color: Float32Array; plate: Uint8Array; surface: number[]; index: number[] };
export type Kit = Record<KitModule, Module>;

/** Metres the edge band (x and z) and the top band (y) keep, per module. */
const MARGIN: Record<KitModule, { edge: number; trim: number }> = {
  ramp: { edge: 0.4, trim: 0.15 }, step: { edge: 0.12, trim: 0.05 }, block: { edge: 0.2, trim: 0.08 },
};
const BAND = 0.4, TOP_BAND = 0.9;
/** A ramp's ground plate shows steel only where the ramp is lower than this; higher up it is riding surface. */
const PLATE_UNDER = 0.4;

/** A unit coordinate (-0.5..0.5, or past it) to metres from the middle of a span `half` wide, the band kept at `edge`. */
export function fitAcross(u: number, half: number, edge: number) {
  const e = Math.min(edge, half * 0.4), a = Math.abs(u), inner = half - e;
  return Math.sign(u) * (a <= BAND ? (a / BAND) * inner : inner + ((a - BAND) / (0.5 - BAND)) * e);
}

/** A unit height (0..1) to a height between `base` and `top`, the top band kept at `trim`. */
export function fitUp(t: number, base: number, top: number, trim: number) {
  const span = Math.max(0.02, top - base), tr = Math.min(trim, span * 0.4);
  return t <= TOP_BAND ? base + (t / TOP_BAND) * (span - tr) : base + span - tr + ((t - TOP_BAND) / (1 - TOP_BAND)) * tr;
}

/** A module out of its GLB: every mesh's vertices in one list, coloured by its material. */
export async function parseModule(glb: ArrayBuffer | string): Promise<Module> {
  const loader = new GLTFLoader();
  const gltf = typeof glb === "string" ? await loader.loadAsync(glb) : await loader.parseAsync(glb, "");
  gltf.scene.updateMatrixWorld(true);
  const pos: number[] = [], color: number[] = [], plate: number[] = [], index: number[] = [];
  let surface = [1, 1, 1];
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld), mat = m.material as THREE.MeshStandardMaterial;
    const p = g.attributes.position!, first = pos.length / 3;
    if (mat.name === "surface") surface = mat.color.toArray();
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      color.push(mat.color.r, mat.color.g, mat.color.b);
      plate.push(mat.name === "plate" ? 1 : 0);
    }
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i);
    for (const i of idx) index.push(first + i);
  });
  return { pos: new Float32Array(pos), color: new Float32Array(color), plate: new Uint8Array(plate), surface, index };
}

/** All three modules at a budget, from `public/models/` (or from bytes, in a test). */
export async function loadKit(budget: KitBudget, read: (file: string) => Promise<ArrayBuffer | string> = async (f) => f): Promise<Kit> {
  const mods = await Promise.all(KIT_MODULES.map(async (k) => parseModule(await read(`models/kit-${k}-${budget}.glb`))));
  return Object.fromEntries(KIT_MODULES.map((k, i) => [k, mods[i]])) as Kit;
}

/**
 * One module fitted over a stretch of a piece, in the piece's own frame: across x, along z from `z0` to `z1`,
 * up from `base` to `top(lx, lz)`.
 */
function fit(m: Module, kind: KitModule, w: number, z0: number, z1: number, base: number, top: (lx: number, lz: number) => number) {
  const { edge, trim } = MARGIN[kind], n = m.pos.length / 3, mid = (z0 + z1) / 2, halfD = (z1 - z0) / 2;
  const pos = new Float32Array(n * 3), col = new Float32Array(m.color);
  for (let i = 0; i < n; i++) {
    const lx = fitAcross(m.pos[i * 3]!, w / 2, edge), lz = mid + fitAcross(m.pos[i * 3 + 2]!, halfD, edge);
    // Sample the surface inside the footprint, so a rib standing past the side still reads the edge's height.
    const h = top(THREE.MathUtils.clamp(lx, -w / 2 + 1e-3, w / 2 - 1e-3), THREE.MathUtils.clamp(lz, z0 + 1e-3, z1 - 1e-3));
    pos.set([lx, fitUp(m.pos[i * 3 + 1]!, base, h, trim), lz], i * 3);
    if (m.plate[i] && h - base > PLATE_UNDER) col.set(m.surface, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(m.index);
  return g;
}

/** A piece dressed in its module (several stairs for a stair set), in world space; null if it has no look. */
export function kitGeometry(p: Piece, kit: Kit, base: number): THREE.BufferGeometry | null {
  const look = p.look;
  if (!look) return null;
  const d = p.d, top = (lx: number, lz: number) => Math.max(base, p.height(lx, lz));
  let parts: THREE.BufferGeometry[];
  if (look.kind === "stairs") {
    // A tread per step, the last running on to the end as the landing; each is level along its run.
    parts = Array.from({ length: look.steps }, (_, i) => {
      const z0 = -d / 2 + i * look.run, z1 = i === look.steps - 1 ? d / 2 : z0 + look.run, zm = (z0 + z1) / 2;
      return fit(kit.step, "step", p.w, z0, z1, base, (lx) => top(lx, zm));
    });
  } else parts = [fit(kit[look.kind], look.kind, p.w, -d / 2, d / 2, base, top)];
  const g = parts.length === 1 ? parts[0]! : mergeGeometries(parts)!;
  g.rotateY(p.yaw);
  g.translate(p.x, 0, p.z);
  g.computeVertexNormals();
  return g;
}
