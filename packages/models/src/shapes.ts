// Low-poly shapes for models built in code (y up, metres): lofted rings, balls and chamfered boxes, each a
// geometry with a material slot name, and `part` to gather pieces into one object with a mesh per slot.
// Written for the scripts that write the apps' GLB files (see glb.ts), so a model needs no Blender.
import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** A piece of a part: its geometry, non-indexed with normals, and the material slot it's painted with. */
export type Piece = { geo: THREE.BufferGeometry; slot: string };

/** One ring of a loft: at height y, radii rx (across) and rz (front to back), centred at (cx, cz). `tilt` lifts
 * the front and drops the back (a hairline), `jag` pushes every other point out (fur, fluff). */
export type Ring = { y: number; rx: number; rz: number; cx: number; cz: number; tilt: number; jag: number };
export const R = (y: number, rx: number, rz = rx, o: { cx?: number; cz?: number; tilt?: number; jag?: number } = {}): Ring =>
  ({ y, rx, rz, cx: o.cx ?? 0, cz: o.cz ?? 0, tilt: o.tilt ?? 0, jag: o.jag ?? 0 });

/** Normals per face (flat) or per corner (smooth), then every triangle its own three corners, so pieces merge. */
function finish(geo: THREE.BufferGeometry, slot: string, smooth = false): Piece {
  for (const k of Object.keys(geo.attributes)) if (k !== "position") geo.deleteAttribute(k);
  if (smooth) { geo.computeVertexNormals(); geo = geo.toNonIndexed(); }
  else { geo = geo.toNonIndexed(); geo.computeVertexNormals(); }
  return { geo, slot };
}

/** Signed volume from the triangles' winding: positive when they face out. */
function volume(pos: number[], idx: number[]) {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]].map((k) => pos.slice(k * 3, k * 3 + 3));
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

export type LoftOptions = {
  /** Points round a ring. */
  seg?: number;
  /** Superellipse power: 2 round, higher is boxier. */
  p?: number;
  /** Where the first point sits; by default half a step round, so a face, not an edge, looks forward. */
  rot?: number;
  caps?: boolean;
  /** Join the last ring back to the first (a lathed brim). */
  closed?: boolean;
  m?: THREE.Matrix4;
  smooth?: boolean;
};

/** Rings stacked along y, each a superellipse, skinned into one solid. A ring with zero radii is a point (a pole). */
export function loft(slot: string, rings: Ring[], { seg = 8, p = 2, rot = Math.PI / seg, caps = true, closed = false, m, smooth = false }: LoftOptions = {}): Piece {
  const base = Array.from({ length: seg }, (_, j) => {
    const a = rot + (2 * Math.PI * j) / seg, c = Math.cos(a), s = Math.sin(a);
    return [Math.sign(c) * Math.abs(c) ** (2 / p), Math.sign(s) * Math.abs(s) ** (2 / p)];
  });
  const pos: number[] = [], idx: number[] = [];
  const vert = (x: number, y: number, z: number) => (pos.push(x, y, z), pos.length / 3 - 1);
  const rows = rings.map(({ y, rx, rz, cx, cz, tilt, jag }) => rx === 0 && rz === 0 ? [vert(cx, y, cz)]
    : base.map(([ux, uz], j) => { const k = j % 2 ? 1 + jag : 1; return vert(cx + ux * rx * k, y + tilt * uz, cz + uz * rz * k); }));
  const n = rows.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = rows[i], b = rows[(i + 1) % n];
    if (a.length === 1 && b.length === 1) continue;
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg;
      if (a.length === 1) idx.push(a[0], b[k], b[j]);
      else if (b.length === 1) idx.push(a[j], a[k], b[0]);
      else idx.push(a[j], a[k], b[k], a[j], b[k], b[j]);
    }
  }
  // The sides above face in for rings running up; the caps are wound to agree, the bottom up and the top down.
  if (caps && !closed) {
    const [first, last] = [rows[0], rows[n - 1]];
    if (first.length > 2) for (let j = 1; j + 1 < seg; j++) idx.push(first[0], first[j + 1], first[j]);
    if (last.length > 2) for (let j = 1; j + 1 < seg; j++) idx.push(last[0], last[j], last[j + 1]);
  }
  // Then face the whole thing outwards, whichever way the rings run.
  if (volume(pos, idx) < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  if (m) geo.applyMatrix4(m);
  return finish(geo, slot, smooth);
}

/** A low-poly sphere (a loft from pole to pole), squashed by `scale`, centred at `at`. */
export function ball(slot: string, r: number, at: THREE.Vector3Tuple, { scale = [1, 1, 1], seg = 8, rings = 5, jag = 0, smooth = false }:
  { scale?: THREE.Vector3Tuple; seg?: number; rings?: number; jag?: number; smooth?: boolean } = {}): Piece {
  const [sx, sy, sz] = scale;
  const rs = [R(-r * sy, 0, 0)];
  for (let i = 1; i < rings; i++) {
    const t = (Math.PI * i) / rings;
    rs.push(R(-Math.cos(t) * r * sy, Math.sin(t) * r * sx, Math.sin(t) * r * sz, { jag }));
  }
  rs.push(R(r * sy, 0, 0));
  return loft(slot, rs, { seg, m: new THREE.Matrix4().makeTranslation(...at), smooth });
}

/** A box `size` big with its edges chamfered `bevel` wide, turned by `rot` (radians about x, then y, then z, as
 * x @ y @ z) about its centre `at`. */
export function box(slot: string, size: THREE.Vector3Tuple, at: THREE.Vector3Tuple, { bevel = 0, rot = [0, 0, 0] }:
  { bevel?: number; rot?: THREE.Vector3Tuple } = {}): Piece {
  const [hx, hy, hz] = size.map((s) => s / 2);
  let geo: THREE.BufferGeometry;
  if (bevel > 0) {
    const pts: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(
      new THREE.Vector3(sx * hx, sy * (hy - bevel), sz * (hz - bevel)),
      new THREE.Vector3(sx * (hx - bevel), sy * hy, sz * (hz - bevel)),
      new THREE.Vector3(sx * (hx - bevel), sy * (hy - bevel), sz * hz));
    geo = new ConvexGeometry(pts);
  } else geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const turn = new THREE.Matrix4().makeRotationX(rot[0]).multiply(new THREE.Matrix4().makeRotationY(rot[1])).multiply(new THREE.Matrix4().makeRotationZ(rot[2]));
  geo.applyMatrix4(new THREE.Matrix4().makeTranslation(...at).multiply(turn));
  return finish(geo, slot);
}

/** Turns a loft built along y to run along `axis` ("x" or "z"), centred at `at`. */
export function along(axis: "x" | "z", at: THREE.Vector3Tuple): THREE.Matrix4 {
  const turn = axis === "x" ? new THREE.Matrix4().makeRotationZ(-Math.PI / 2) : new THREE.Matrix4().makeRotationX(Math.PI / 2);
  return new THREE.Matrix4().makeTranslation(...at).multiply(turn);
}

/** name -> [colour (sRGB hex), roughness, metalness, glow?]: a slot's look. */
export type Palette = Record<string, [string, number, number, number?]>;

/** Pieces gathered into one object called `name`, a mesh per material slot (named for its slot). */
export function part(name: string, pieces: Piece[], palette: Palette, m?: THREE.Matrix4): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const slots = [...new Set(pieces.map((p) => p.slot))];
  for (const slot of slots) {
    // corners that share a place and a normal become one vertex again, which keeps the file small
    let geo = mergeGeometries(pieces.filter((p) => p.slot === slot).map((p) => p.geo))!;
    if (m) geo.applyMatrix4(m);
    geo = mergeVertices(geo);
    const [color, roughness, metalness, glow] = palette[slot];
    const mat = new THREE.MeshStandardMaterial({ name: slot, color, roughness, metalness, flatShading: false });
    if (glow) { mat.emissive.set(color); mat.emissiveIntensity = glow; }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${name}-${slot}`;
    g.add(mesh);
  }
  return g;
}

/** Triangles in an object, for budgets. */
export function triangles(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => { const g = (c as THREE.Mesh).isMesh ? (c as THREE.Mesh).geometry : null; if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3; });
  return n;
}
