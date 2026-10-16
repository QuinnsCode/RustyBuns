// The look of the skate pieces. One generic mesher samples a piece's own `height(localX, localZ)` into a
// solid (so no piece kind has geometry written by hand), paints it in colour blocks (planks of painted
// wood on the ramps, concrete on the bowls and landings, a bright band round each edge), and every piece
// of a level merges into one mesh. Rails, ledge edges and coping merge into a second: steel, with pale
// grind wax rubbed onto it in streaks. Two draw calls for a whole park, however many pieces it has.
import { mulberry32 } from "@rustybuns/util";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Level, type Piece, type Rail, railY } from "../level.ts";

type Ground = (x: number, z: number) => number;
const rgb = (hex: number) => new THREE.Color(hex);

const WOOD = rgb(0xc98a52), SEAM = rgb(0x6e4526), CONCRETE = rgb(0xb9b3aa), SIDE = rgb(0x9d978d);
const BAND = { wood: rgb(0xe2572b), concrete: rgb(0x2e7f86) };
const STEEL = rgb(0xa5acb4), WAX = rgb(0xf3ead2);
const CONCRETE_NAMES = /bowl|roll-in|landing|boulder|log|cone|roller/;

/** Painted wood or concrete, by what the piece is. */
const isConcrete = (p: Piece) => p.kind === "box" || CONCRETE_NAMES.test(p.name);

/**
 * A piece as a closed solid hanging from `base`: its top sampled from its own height function on a grid
 * (finer where a stair's risers or a plank seam need it), the sides dropped straight to `base`.
 */
export function pieceGeometry(p: Piece, base = 0): THREE.BufferGeometry {
  const concrete = isConcrete(p);
  const cell = Math.max(concrete ? 0.25 : 0.1, Math.sqrt((p.w * p.d) / 30000));
  const nx = Math.max(2, Math.ceil(p.w / cell)), nz = Math.max(2, Math.ceil(p.d / cell));
  const top = (lx: number, lz: number) => Math.max(base, p.height(lx, lz));
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const band = BAND[concrete ? "concrete" : "wood"], c = new THREE.Color();
  const grid = (i: number, j: number): [number, number] => [-p.w / 2 + (i / nx) * p.w, -p.d / 2 + (j / nz) * p.d];

  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const [lx, lz] = grid(i, j);
    pos.push(lx, top(lx, lz), lz);
    const edge = Math.min(p.w / 2 - Math.abs(lx), p.d / 2 - Math.abs(lz));
    if (edge < 0.3) c.copy(band);
    else if (concrete) c.copy(CONCRETE);
    else { // planks along the piece, a dark seam between each
      const along = ((lz + p.d / 2) / 0.5) % 1, plank = Math.floor((lz + p.d / 2) / 0.5);
      c.copy(WOOD).multiplyScalar(0.94 + 0.06 * ((plank * 7) % 3 === 0 ? 0 : 1));
      if (along < 0.12) c.lerp(SEAM, 0.7);
    }
    col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const top3 = new THREE.BufferGeometry();
  top3.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  top3.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  top3.setIndex(idx);
  top3.computeVertexNormals();

  // Sides: along each of the four edges, a wall from the top down to base.
  const sp: number[] = [], sc: number[] = [], si: number[] = [];
  const wall = (pts: [number, number][], outward: number) => {
    const o = sp.length / 3;
    for (const [lx, lz] of pts) sp.push(lx, top(lx, lz), lz, lx, base, lz), sc.push(SIDE.r, SIDE.g, SIDE.b, SIDE.r, SIDE.g, SIDE.b);
    for (let k = 0; k < pts.length - 1; k++) {
      const a = o + k * 2;
      if (outward > 0) si.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      else si.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
  };
  wall(Array.from({ length: nx + 1 }, (_, i) => grid(i, 0)), -1);
  wall(Array.from({ length: nx + 1 }, (_, i) => grid(i, nz)), 1);
  wall(Array.from({ length: nz + 1 }, (_, j) => grid(0, j)), 1);
  wall(Array.from({ length: nz + 1 }, (_, j) => grid(nx, j)), -1);
  const sides = new THREE.BufferGeometry();
  sides.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  sides.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3));
  sides.setIndex(si);
  sides.computeVertexNormals();

  const g = mergeGeometries([top3, sides])!;
  g.rotateY(p.yaw);
  g.translate(p.x, 0, p.z);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
/** A cylinder from A to B in `color`. */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.Color) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 8, 1).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

/** A rail, a ledge's steel edge or a coping pipe, with streaks of wax and (for a rail) posts down to the ground. */
export function railGeometry(r: Rail, ground: Ground = () => 0, seed = 1): THREE.BufferGeometry[] {
  const rng = mulberry32(seed), y2 = r.y2 ?? r.y;
  const at = (t: number, lift = 0) => new THREE.Vector3(r.a.x + (r.b.x - r.a.x) * t, railY(r, t) + lift, r.a.z + (r.b.z - r.a.z) * t);
  const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) || 1;
  const radius = r.kind === "rail" ? 0.04 : r.kind === "coping" ? 0.07 : 0.05;
  const out = [strut(new THREE.Vector3(r.a.x, r.y, r.a.z), new THREE.Vector3(r.b.x, y2, r.b.z), radius, STEEL)];
  // Wax rubbed on by grinds: a few pale streaks, a hand's width longer than the bar is thick.
  for (let k = 0, n = Math.max(1, Math.round(len / 3)); k < n; k++) {
    const t0 = rng() * 0.8, t1 = Math.min(1, t0 + (0.4 + rng() * 0.8) / len);
    out.push(strut(at(t0), at(t1), radius + 0.008, WAX));
  }
  if (r.kind === "rail") for (let z = 0.5; z < len; z += 4) {
    const t = z / len, top = at(t), foot = ground(top.x, top.z);
    if (top.y - foot > 0.05) out.push(strut(new THREE.Vector3(top.x, foot, top.z), top, 0.035, STEEL));
  }
  return out;
}

/** Every piece and rail of a level, as two meshes. `ground` is the terrain under them (0 on a plaza floor). */
export function levelMeshes(level: Level, ground?: Ground) {
  const group = new THREE.Group();
  const low = (p: Piece) => { // a piece hangs from its pad's floor: the lowest ground under its footprint
    if (!ground) return 0;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    let m = Infinity;
    for (const [fx, fz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = (fx * p.w) / 2, z = (fz * p.d) / 2;
      m = Math.min(m, ground(p.x + x * c + z * s, p.z - x * s + z * c));
    }
    return m;
  };
  if (level.pieces.length) {
    const m = new THREE.Mesh(mergeGeometries(level.pieces.map((p) => pieceGeometry(p, low(p))))!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    m.castShadow = m.receiveShadow = true;
    m.name = "pieces";
    group.add(m);
  }
  if (level.rails.length) {
    const m = new THREE.Mesh(mergeGeometries(level.rails.flatMap((r, i) => railGeometry(r, ground, i + 1)))!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.7 }));
    m.castShadow = true;
    m.name = "rails";
    group.add(m);
  }
  return group;
}
