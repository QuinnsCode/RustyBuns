// What lies on the ground round your feet, with height: fallen leaves, twigs, tufts of needles, cones and pebbles, a few
// thousand small pieces in a ring round the player (the ground texture gives the floor its grain; this gives it things
// that stand off it and catch the light). Laid like the grass (scatterTurf): a few ms a frame, copied in at once.
import * as THREE from "three";
import { clamp01 } from "@rustybuns/util";
import type { Biome, Region } from "../regions.ts";
import { FLORA, grove, plantBudget, TREELINE } from "./flora.ts";

export const PIECES = ["leaf", "twig", "needles", "cone", "pebble"] as const;
export type Piece = (typeof PIECES)[number];

/** Per biome and piece: pieces a square metre where the trees stand thickest, the share of that out in the open (pebbles
 * lie anywhere, so theirs is 1), the size range in metres and the colours (an instance takes one, shaded a little). */
type Spec = { d: number; open: number; size: [number, number]; colours: number[] };
const S = (d: number, open: number, size: [number, number], ...colours: number[]): Spec => ({ d, open, size, colours });
const BROADLEAF = [0x8a5a2b, 0x6e4a26, 0xa06a2a, 0x7a3a22, 0x5e4c2c, 0x76682e, 0x9a7a3a];
const WET_LEAF = [0x4a3a24, 0x5a4628, 0x3e3a22, 0x4e4228, 0x5c5030];
const TWIG = [0x4a3a2c, 0x5a4636, 0x3a3028, 0x6a5a48];
const NEEDLE = [0x9a5a2e, 0x7a4a26, 0xb07a40, 0x8a6236];
const STONE = [0x8a8680, 0x6e6a64, 0x9a9488, 0x7a7068];
const leafy = (d: number, colours = BROADLEAF, size: [number, number] = [0.14, 0.26]) => ({ leaf: S(d, 0.4, size, ...colours), twig: S(0.3, 0.1, [0.25, 0.7], ...TWIG), pebble: S(0.12, 1, [0.05, 0.14], ...STONE) });
const piney = (d: number) => ({ needles: S(d, 0.35, [0.16, 0.28], ...NEEDLE), cone: S(0.28, 0.05, [0.05, 0.08], 0x6a4426, 0x5a3a22, 0x7a5030), twig: S(0.3, 0.1, [0.25, 0.6], ...TWIG), pebble: S(0.12, 1, [0.05, 0.14], ...STONE) });
const open = (pebbles: number, colours = STONE) => ({ pebble: S(pebbles, 1, [0.05, 0.18], ...colours), twig: S(0.05, 1, [0.2, 0.5], 0xa89a88, 0x8a7a68) });
const LITTER: Record<Biome, Partial<Record<Piece, Spec>>> = {
  "pine-barrens": piney(8), forest: leafy(14), rainforest: leafy(10, WET_LEAF, [0.2, 0.38]), lake: piney(5), desert: open(3, [0x9a8a78, 0x7a6a5a, 0xa8907a, 0x8a5a40, 0x6a6460, 0xb09a80]),
  swamp: leafy(9, WET_LEAF, [0.14, 0.28]), plains: open(0.25), highlands: open(0.8), jungle: leafy(10, WET_LEAF, [0.2, 0.4]), island: open(0.3), mountains: { ...piney(3), ...{ pebble: S(0.9, 1, [0.05, 0.2], ...STONE) } },
  river: leafy(6), coast: open(0.6), savanna: open(0.4, [0x9a8470, 0x8a6a50, 0xa89078]), tundra: open(0.9), steppe: open(0.35),
};

const R = 30;           // metres round you the litter lies
const FADE = 20;        // from here out to R it thins to nothing, so the ring has no edge
const BLOCK = 2;        // metres a block: its region, trees and water are read once
const CAP = 16000;      // pieces a kind can show at once

function hash(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function geo(pos: number[], col: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
/** A leaf 1 m long along x, cupped (its edges up off the midrib) and its tip curled, so each half takes the light its own way. */
function leaf() {
  const S = [-0.5, 0.06, 0], C = [0, 0, 0], T = [0.5, 0.1, 0], L = [0, 0.1, 0.3], Rr = [0, 0.1, -0.3], l2 = [-0.25, 0.07, 0.24], r2 = [-0.25, 0.07, -0.24];
  const tris = [S, l2, C, l2, L, C, C, L, T, S, C, r2, r2, C, Rr, C, T, Rr];
  const dark = (p: number[]) => (p === C || p === S ? 0.72 : 1);
  return geo(tris.flat(), tris.flatMap((p) => [dark(p), dark(p), dark(p)]));
}
/** A twig 1 m long along x, a few centimetres thick, with a short fork two thirds along. */
function twig() {
  const pos: number[] = [], col: number[] = [];
  const prism = (x0: number, z0: number, x1: number, z1: number, r: number) => {
    const ring = (x: number, z: number) => [0, 1, 2].map((k) => { const a = (k / 3) * Math.PI * 2; const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz); return [x - (dz / l) * Math.cos(a) * r, r + Math.sin(a) * r, z + (dx / l) * Math.cos(a) * r]; });
    const a = ring(x0, z0), b = ring(x1, z1);
    for (let k = 0; k < 3; k++) { const n = (k + 1) % 3; pos.push(...a[k]!, ...b[k]!, ...b[n]!, ...a[k]!, ...b[n]!, ...a[n]!); for (let v = 0; v < 6; v++) col.push(0.85, 0.85, 0.85); }
  };
  prism(-0.5, 0, 0.5, 0, 0.032); prism(0.17, 0, 0.42, 0.16, 0.02);
  return geo(pos, col);
}
/** A drift of fallen needles 1 m long: seven slivers lying roughly one way, fanned a little and side by side, some
 * resting on the others so the drift has a ridge. */
function needles() {
  const pos: number[] = [], col: number[] = [], fan = [-0.32, 0.12, -0.05, 0.27, -0.18, 0.04, 0.4], side = [-0.18, -0.12, -0.04, 0.02, 0.09, 0.15, 0.22];
  for (let k = 0; k < 7; k++) {
    const a = fan[k]!, c = Math.cos(a), s = Math.sin(a), ox = (k % 3 - 1) * 0.08, oz = side[k]!, w = 0.035, h = 0.025 + 0.03 * ((k * 5) % 3);
    const at = (u: number, v: number, y: number) => [ox + u * c - v * s, y, oz + u * s + v * c];
    const p = [at(-0.5, -w, 0.01), at(0.5, -w, 0.01), at(0, 0, h)], q = [at(0.5, w, 0.01), at(-0.5, w, 0.01), at(0, 0, h)];
    for (const t of [p, q]) for (const v of t) { pos.push(...v); const l = 0.78 + 0.05 * k; col.push(l, l, l); }
  }
  return geo(pos, col);
}
/** A lumpy stone 1 m across: a low-poly ball, dented and flattened, darker underneath. */
function stone(seed: number, flat: number) {
  const g = new THREE.IcosahedronGeometry(0.5, 0).toNonIndexed(), p = g.attributes.position!;
  const col: number[] = [], pos: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.8 + 0.35 * hash(Math.round(x * 97), Math.round(z * 89 + y * 53), seed);
    pos.push(x * k, (y * k + 0.15) * flat, z * k);
    const l = y < 0 ? 0.7 : 1; col.push(l, l, l);
  }
  g.dispose();
  return geo(pos, col);
}
const SHAPES: Record<Piece, () => THREE.BufferGeometry> = { leaf, twig, needles, cone: () => stone(3, 1.1), pebble: () => stone(7, 0.55) };

export interface Litter {
  group: THREE.Group;
  meshes: Map<Piece, THREE.InstancedMesh>;
  /** The next laying, block row by block row, until it is copied into the meshes at once. */
  job: { cx: number; cz: number; bz: number; n: Map<Piece, number>; mats: Map<Piece, Float32Array>; cols: Map<Piece, Float32Array> } | null;
  pieces: number;
}

export function litter(): Litter {
  const f: Litter = { group: new THREE.Group(), meshes: new Map(), job: null, pieces: 0 };
  for (const p of PIECES) {
    const m = new THREE.InstancedMesh(SHAPES[p](), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: p === "pebble" || p === "cone" ? 0.85 : 0.75, flatShading: true, side: THREE.DoubleSide }), CAP);
    m.count = 0; m.receiveShadow = true;
    m.setColorAt(0, new THREE.Color());
    f.meshes.set(p, m); f.group.add(m);
  }
  return f;
}

const o = new THREE.Object3D(), c = new THREE.Color();

/** Lays the litter round (cx, cz), where `regionOf` says something grows, for up to `budget` ms; true once it is in. */
export function scatterLitter(f: Litter, cx: number, cz: number, regionOf: (x: number, z: number) => Region | undefined, yAt: (x: number, z: number) => number, waterAt: (x: number, z: number) => number = () => 0, budget = Infinity): boolean {
  const t0 = performance.now(), low = plantBudget().reach < 1e5, r = low ? R * 0.6 : R, fade = low ? FADE * 0.6 : FADE, thin = low ? 0.4 : 1;
  const b0 = Math.floor((cz - r) / BLOCK), b1 = Math.floor((cz + r) / BLOCK);
  let j = f.job;
  if (!j || j.cx !== cx || j.cz !== cz) {
    j = f.job = { cx, cz, bz: b0, n: new Map(PIECES.map((p) => [p, 0])), mats: j?.mats ?? new Map(PIECES.map((p) => [p, new Float32Array(CAP * 16)])), cols: j?.cols ?? new Map(PIECES.map((p) => [p, new Float32Array(CAP * 3)])) };
  }
  for (; j.bz <= b1; j.bz++) {
    if (j.bz > b0 && performance.now() - t0 > budget) return false;
    const bz = j.bz;
    for (let bx = Math.floor((cx - r) / BLOCK); bx <= Math.floor((cx + r) / BLOCK); bx++) {
      const mx = (bx + 0.5) * BLOCK, mz = (bz + 0.5) * BLOCK, dm = Math.hypot(mx - cx, mz - cz);
      if (dm > r + BLOCK) continue;
      const g = regionOf(mx, mz);
      if (!g) continue;
      const y0 = yAt(mx, mz);
      if (y0 < 0.3 || y0 > TREELINE + 6 || y0 - waterAt(mx, mz) < 0.15) continue;
      const trees = clamp01((grove(mx, mz) - 0.45) / 0.3) * Math.min(1, FLORA[g.biome].density * 1.4);
      for (const [p, s] of Object.entries(LITTER[g.biome]) as [Piece, Spec][]) {
        const want = s.d * (s.open + (1 - s.open) * trees) * BLOCK * BLOCK * thin;
        const count = Math.floor(want + hash(bx, bz, PIECES.indexOf(p) + 90));
        const mats = j.mats.get(p)!, cols = j.cols.get(p)!;
        for (let k = 0; k < count; k++) {
          const n = j.n.get(p)!;
          if (n >= CAP) break;
          const salt = PIECES.indexOf(p) * 31 + k * 7, h = (i: number) => hash(bx * 13 + k, bz * 17 - k, salt + i);
          const x = (bx + h(1)) * BLOCK, z = (bz + h(2)) * BLOCK, d = Math.hypot(x - cx, z - cz);
          if (d > r || (d > fade && h(3) < (d - fade) / (r - fade))) continue;
          const y = yAt(x, z);
          if (y - waterAt(x, z) < 0.15) continue;
          // a piece lies with the ground under it, turned any way, a leaf or a needle tuft tipped a little more
          const e = 0.4, tx = Math.atan2(y - yAt(x, z + e), e), tz = Math.atan2(yAt(x + e, z) - y, e);
          const size = s.size[0] + (s.size[1] - s.size[0]) * h(4) ** 1.5, tip = p === "leaf" || p === "needles" ? 0.35 : 0.1;
          o.position.set(x, y + (p === "pebble" ? -size * 0.12 : p === "cone" ? size * 0.2 : 0.005), z);
          o.rotation.set(tx + (h(5) - 0.5) * tip, h(6) * Math.PI * 2, tz + (h(7) - 0.5) * tip, "YXZ");
          if (p === "leaf") o.scale.set(size, size * (0.8 + 0.6 * h(8)), size * (0.55 + 0.35 * h(9)));
          else if (p === "cone") o.scale.set(size * 1.6, size, size);
          else o.scale.setScalar(size * (p === "pebble" ? 0.8 + 0.5 * h(8) : 1));
          o.updateMatrix();
          o.matrix.toArray(mats, n * 16);
          const l = 0.82 + 0.3 * h(10);
          c.setHex(s.colours[Math.floor(h(11) * s.colours.length)]!).multiplyScalar(l).toArray(cols, n * 3);
          j.n.set(p, n + 1);
        }
      }
    }
  }
  f.pieces = 0;
  for (const [p, m] of f.meshes) {
    const n = j.n.get(p)!;
    m.instanceMatrix.array.set(j.mats.get(p)!.subarray(0, n * 16));
    m.instanceColor!.array.set(j.cols.get(p)!.subarray(0, n * 3));
    m.count = n; f.pieces += n;
    m.instanceMatrix.needsUpdate = true; m.instanceColor!.needsUpdate = true;
    m.computeBoundingSphere();
  }
  f.job = null;
  return true;
}
