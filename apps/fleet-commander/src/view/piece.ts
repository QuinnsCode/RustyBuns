// What every sheet-built shape is made from: the shared materials, a piece that bakes to one mesh per material, and
// the few forms the three.js primitives don't give (a box along a run, a rod between two points, a lofted body).
import * as THREE from "three";

const ENGINE_BLUE = 0x9fd8ff, ENGINE_ORANGE = 0xffb36b;

/** One material per slot, shared by every hull (the scene swaps them for the holo table and back). */
export const MAT = {
  hull: new THREE.MeshStandardMaterial({ color: 0xc9cdd3, roughness: 0.55, metalness: 0.35, flatShading: true }),
  plate: new THREE.MeshStandardMaterial({ color: 0xaeb3ba, roughness: 0.62, metalness: 0.35, flatShading: true }),
  dark: new THREE.MeshStandardMaterial({ color: 0x5f656e, roughness: 0.7, metalness: 0.3, flatShading: true }),
  window: new THREE.MeshBasicMaterial({ color: 0xfff1c8 }),
  engine: new THREE.MeshBasicMaterial({ color: ENGINE_BLUE }),
  // The Compact's: rusted plate, ochre where it was patched, black iron for the frames, amber lamps, orange fire.
  rust: new THREE.MeshStandardMaterial({ color: 0x9a6a45, roughness: 0.82, metalness: 0.25, flatShading: true }),
  ochre: new THREE.MeshStandardMaterial({ color: 0xb98a46, roughness: 0.78, metalness: 0.2, flatShading: true }),
  iron: new THREE.MeshStandardMaterial({ color: 0x3f322a, roughness: 0.9, metalness: 0.3, flatShading: true }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  fire: new THREE.MeshBasicMaterial({ color: ENGINE_ORANGE }),
};
export type Slot = keyof typeof MAT;

/** A piece while it is built: meshes in the hull's frame, each in a slot's material. */
export class Piece {
  readonly parts: [THREE.BufferGeometry, Slot][] = [];
  add(geo: THREE.BufferGeometry, slot: Slot, at?: THREE.Vector3, rot?: THREE.Euler) {
    const m = new THREE.Matrix4().compose(at ?? new THREE.Vector3(), new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(1, 1, 1));
    this.parts.push([geo.applyMatrix4(m), slot]);
    return this;
  }
  /** One mesh per slot. */
  bake(name: string): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const slot of Object.keys(MAT) as Slot[]) {
      const geos = this.parts.filter(([, s]) => s === slot).map(([geo]) => geo);
      if (!geos.length) continue;
      const mesh = new THREE.Mesh(merge(geos), MAT[slot]);
      mesh.name = `${name}:${slot}`;
      if (slot === "engine" || slot === "fire") mesh.userData.engine = true;
      g.add(mesh);
    }
    return g;
  }
}

/** Every geometry's positions, flat, in one unindexed buffer with its normals worked out again. */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geos.map((geo) => (geo.index ? geo.toNonIndexed() : geo));
  const pos = new Float32Array(flat.reduce((k, geo) => k + geo.getAttribute("position").count * 3, 0));
  let at = 0;
  for (const geo of flat) { const p = geo.getAttribute("position").array; pos.set(p, at); at += p.length; }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A box from a to b (its length), `w` across and `h` high, its up kept as near +y as the run allows. */
export function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number) {
  const len = a.distanceTo(b), g = new THREE.BoxGeometry(len, h, w);
  const dir = b.clone().sub(a).normalize(), q = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), dir);
  return g.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** A rod of radius r from a to b. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8) {
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return g.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** One cross-section of a lofted body: at `x`, `half` out to each side, `top` above the axis and `bottom` below. */
export type Station = readonly [x: number, half: number, top: number, bottom: number];

/** The point `i` of `sides` round a station (0 is starboard, a quarter round is the top). */
export function stationPoint([x, half, top, bottom]: Station, i: number, sides: number) {
  const a = (i / sides) * Math.PI * 2, s = Math.sin(a);
  return V(x, s * (s >= 0 ? top : bottom), Math.cos(a) * half);
}

/** A body lofted through its stations along x (stern first), `sides` flat faces round, its ends closed. */
export function loft(stations: readonly Station[], sides: number): THREE.BufferGeometry {
  const tris: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3) => {
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-9) return;
    if (n.dot(out) < 0) [b, c] = [c, b];
    tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let k = 0; k + 1 < stations.length; k++) {
    for (let i = 0; i < sides; i++) {
      const a = stationPoint(stations[k]!, i, sides), b = stationPoint(stations[k]!, i + 1, sides);
      const c = stationPoint(stations[k + 1]!, i + 1, sides), d = stationPoint(stations[k + 1]!, i, sides);
      const mid = stationPoint(stations[k]!, i + 0.5, sides).add(stationPoint(stations[k + 1]!, i + 0.5, sides));
      const out = V(0, mid.y, mid.z);
      tri(a, b, c, out);
      tri(a, c, d, out);
    }
  }
  for (const [s, way] of [[stations[0]!, -1], [stations.at(-1)!, 1]] as const) {
    const centre = V(s[0], 0, 0);
    for (let i = 0; i < sides; i++) tri(centre, stationPoint(s, i, sides), stationPoint(s, i + 1, sides), V(way, 0, 0));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
  g.computeVertexNormals();
  return g;
}
