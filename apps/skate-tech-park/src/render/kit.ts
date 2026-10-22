// The kit modelled in Blender (blender/kit.py): a wooden ramp, a concrete stair, a concrete block, a granite
// boulder, a fallen log and a wooden hip, each a unit box that is fitted to a piece here. x and z run -0.5..0.5
// across and along the piece and y runs 0 (its pad) to 1 (its riding surface at that point), so the top is the
// piece's own height function, drape and all, and what you see is what you ride. The outer tenth of x and z and
// the top tenth of y keep a size in metres (`MARGIN`), so trim, nosings and bevels don't stretch with the piece;
// the landscape pieces stretch evenly instead, since their shape is the whole module. Colours come from the
// model's materials and are baked into vertex colours, so the kit still merges into the one pieces mesh.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Piece } from "../level.ts";

export const KIT_MODULES = ["ramp", "step", "block", "rock", "log", "hip", "cliff", "bowl", "table", "bench", "boardwalk"] as const;
export const KIT_BUDGETS = ["hi", "mid", "low"] as const;
export type KitModule = (typeof KIT_MODULES)[number];
export type KitBudget = (typeof KIT_BUDGETS)[number];

/**
 * A module as flat arrays: unit positions, baked colours, and which vertices are the steel ground plate (1) or a
 * pool's shaded surface (2), with the riding surface's colour for a plate that has risen off the ground.
 */
export type Module = { pos: Float32Array; color: Float32Array; plate: Uint8Array; surface: number[]; index: number[] };
export type Kit = Record<KitModule, Module>;

/**
 * Metres the edge band keeps across (x) and along (z), and the top band (y), per module. A null edge stretches with
 * the piece instead, so the module maps on linearly: a boulder's dome or a hip's creases land where the piece has them.
 */
const MARGIN: Record<KitModule, { x: number | null; z: number | null; trim: number }> = {
  ramp: { x: 0.4, z: 0.4, trim: 0.15 }, step: { x: 0.12, z: 0.12, trim: 0.05 }, block: { x: 0.2, z: 0.2, trim: 0.08 },
  rock: { x: null, z: null, trim: 0.3 }, log: { x: null, z: 0.8, trim: 0.15 }, hip: { x: null, z: null, trim: 0.1 },
  cliff: { x: null, z: null, trim: 0.3 }, bowl: { x: 0.3, z: 0.3, trim: 0.1 },
  // furniture stretches with its piece: the planks and legs are where the piece has them, only the top's thickness is fixed
  table: { x: null, z: null, trim: 0.12 }, bench: { x: null, z: null, trim: 0.1 }, boardwalk: { x: null, z: null, trim: 0.12 },
};
const BAND = 0.4, TOP_BAND = 0.9;
/** A pool's surface is shaded by how far up the wall it is (0 the floor, 1 the deck): a darker floor and a band of tile near the lip. */
const POOL_FLOOR = new THREE.Color(0x8f8a82), POOL_TILE = new THREE.Color(0x2e7f86);
/** A ramp's ground plate shows steel only where the ramp is lower than this; higher up it is riding surface. */
const PLATE_UNDER = 0.4;

/**
 * A unit coordinate (-0.5..0.5, or past it) to metres from the middle of a span `half` wide, the band kept at `edge`
 * (null: a fifth of the span, which makes the map linear).
 */
export function fitAcross(u: number, half: number, edge: number | null) {
  const e = Math.min(edge ?? half * 0.2, half * 0.4), a = Math.abs(u), inner = half - e;
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
      plate.push(mat.name === "plate" ? 1 : mat.name === "pool" ? 2 : 0);
    }
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i);
    for (const i of idx) index.push(first + i);
  });
  return { pos: new Float32Array(pos), color: new Float32Array(color), plate: new Uint8Array(plate), surface, index };
}

/** Every module at a budget, from `public/models/` (or from bytes, in a test). */
export async function loadKit(budget: KitBudget, read: (file: string) => Promise<ArrayBuffer | string> = async (f) => f): Promise<Kit> {
  const mods = await Promise.all(KIT_MODULES.map(async (k) => parseModule(await read(`models/kit-${k}-${budget}.glb`))));
  return Object.fromEntries(KIT_MODULES.map((k, i) => [k, mods[i]])) as Kit;
}

/**
 * One module fitted over a stretch of a piece, in the piece's own frame: across x, along z from `z0` to `z1`,
 * up from `base` to `top(lx, lz)`.
 */
function fit(m: Module, kind: KitModule, w: number, z0: number, z1: number, base: number, top: (lx: number, lz: number) => number) {
  const { x: ex, z: ez, trim } = MARGIN[kind], n = m.pos.length / 3, mid = (z0 + z1) / 2, halfD = (z1 - z0) / 2;
  const pos = new Float32Array(n * 3), col = new Float32Array(m.color), bare = new Uint8Array(n), hs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lx = fitAcross(m.pos[i * 3]!, w / 2, ex), lz = mid + fitAcross(m.pos[i * 3 + 2]!, halfD, ez);
    // Sample the surface inside the footprint, so a rib standing past the side still reads the edge's height.
    const h = hs[i] = top(THREE.MathUtils.clamp(lx, -w / 2 + 1e-3, w / 2 - 1e-3), THREE.MathUtils.clamp(lz, z0 + 1e-3, z1 - 1e-3));
    pos.set([lx, fitUp(m.pos[i * 3 + 1]!, base, h, trim), lz], i * 3);
    bare[i] = kind !== "bowl" && h <= base + 1e-3 ? 1 : 0; // a pool's floor is the point, so it stays
    if (m.plate[i] === 1 && h - base > PLATE_UNDER) col.set(m.surface, i * 3);
  }
  if (kind === "bowl") {
    const peak = Math.max(0.1, hs.reduce((a, h) => Math.max(a, h), base) - base), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      if (m.plate[i] !== 2) continue;
      const r = (hs[i]! - base) / peak;
      c.fromArray(col, i * 3);
      if (r < 0.04) c.lerp(POOL_FLOOR, 0.9);
      else if (r > 0.55 && r < 0.7) c.lerp(POOL_TILE, 0.85);
      c.toArray(col, i * 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  // Triangles where the piece has no height at all are on or under the ground: a boulder's corners past its dome, say. Drop them.
  const flat = (i: number) => bare[m.index[i]!] === 1;
  g.setIndex(m.index.filter((_, i) => { const t = i - (i % 3); return !(flat(t) && flat(t + 1) && flat(t + 2)); }));
  return g;
}

/** A piece dressed in its module (several stairs for a stair set), in world space; null if it has no look. */
export function kitGeometry(p: Piece, kit: Kit, base: number): THREE.BufferGeometry | null {
  const look = p.look;
  if (!look) return null;
  const d = p.d, top = (lx: number, lz: number) => Math.max(base, p.height(lx, lz));
  let parts: THREE.BufferGeometry[];
  if (look.kind === "stairs") {
    // A tread per step, each level along its run, and the last running on to the end as the landing, which
    // follows the ground under it instead: it is long enough that a slope would leave it floating or buried.
    parts = Array.from({ length: look.steps }, (_, i) => {
      const land = i === look.steps - 1, z0 = -d / 2 + i * look.run, z1 = land ? d / 2 : z0 + look.run, zm = (z0 + z1) / 2;
      return fit(kit.step, "step", p.w, z0, z1, base, land ? top : (lx) => top(lx, zm));
    });
  } else parts = [fit(kit[look.kind], look.kind, p.w, -d / 2, d / 2, base, top)];
  const g = parts.length === 1 ? parts[0]! : mergeGeometries(parts)!;
  g.rotateY(p.yaw);
  g.translate(p.x, 0, p.z);
  g.computeVertexNormals();
  return g;
}
