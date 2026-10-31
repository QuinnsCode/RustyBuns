// A sheet's eyes are plain balls in one glowing colour, so every beast stared out of two stickers. Here each
// ball (a connected piece of the `eye` part) gets a pupil: a flattened dark disc set into its front, where a
// beast facing +x looks (forward, and out to its own side), skinned to whatever bone carries that eye.
import * as THREE from "three";

export interface Ball { centre: THREE.Vector3; r: number; vertex: number }

/** The separate balls in a geometry, by the triangles that join its vertices. */
export function balls(g: THREE.BufferGeometry): Ball[] {
  const pos = g.getAttribute("position"), n = pos.count, up = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (up[i] !== i) i = up[i] = up[up[i]!]!; return i; };
  const idx = g.index;
  const tri = idx ? idx.count : n;
  for (let t = 0; t + 2 < tri; t += 3) {
    const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
    up[find(b)] = find(a); up[find(c)] = find(a);
  }
  // vertices split at a seam sit on the same spot: join those too
  const at = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    const j = at.get(k);
    if (j === undefined) at.set(k, i); else up[find(i)] = find(j);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const r = find(i); let l = groups.get(r); if (!l) groups.set(r, (l = [])); l.push(i); }
  const v = new THREE.Vector3();
  return [...groups.values()].filter((l) => l.length >= 8).map((l) => {
    const centre = new THREE.Vector3();
    for (const i of l) centre.add(v.fromBufferAttribute(pos, i));
    centre.divideScalar(l.length);
    let r = 0, vertex = l[0]!;
    for (const i of l) { const d = v.fromBufferAttribute(pos, i).distanceTo(centre); if (d > r) { r = d; vertex = i; } }
    return { centre, r, vertex };
  });
}

/** Where a ball looks: forward (+x), turned out to the side it sits on; one on the centreline looks straight ahead. */
export function gaze(b: Ball): THREE.Vector3 {
  const side = Math.abs(b.centre.z) < b.r * 0.5 ? 0 : Math.sign(b.centre.z);
  return new THREE.Vector3(1, 0, side * 0.75).normalize();
}

/**
 * One dark pupil per ball, as a geometry with the skin attributes of the ball's own vertex, so it rides the same
 * bone. `skinIndex` and `skinWeight` are the eye part's (4 per vertex).
 */
export function pupils(g: THREE.BufferGeometry, skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>): THREE.BufferGeometry | null {
  const found = balls(g);
  if (!found.length) return null;
  const pieces: THREE.BufferGeometry[] = [];
  for (const b of found) {
    const d = gaze(b), disc = new THREE.SphereGeometry(1, 12, 8);
    disc.scale(0.2, 0.62, 0.24); // a slit: flat along the gaze, tall and narrow like a beast's
    disc.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d));
    disc.scale(b.r, b.r, b.r);
    disc.translate(b.centre.x + d.x * b.r * 0.86, b.centre.y + d.y * b.r * 0.86, b.centre.z + d.z * b.r * 0.86);
    const n = disc.getAttribute("position").count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { si[i * 4 + k] = skinIndex[b.vertex * 4 + k]!; sw[i * 4 + k] = skinWeight[b.vertex * 4 + k]!; }
    disc.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    disc.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    pieces.push(disc.toNonIndexed());
  }
  return merge(pieces);
}

function merge(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "skinIndex", "skinWeight"] as const) {
    const first = pieces[0]!.getAttribute(name);
    const total = pieces.reduce((s, p) => s + p.getAttribute(name).array.length, 0);
    const arr = first.array instanceof Uint16Array ? new Uint16Array(total) : new Float32Array(total);
    let o = 0;
    for (const p of pieces) { arr.set(p.getAttribute(name).array as ArrayLike<number>, o); o += p.getAttribute(name).array.length; }
    out.setAttribute(name, name === "skinIndex" ? new THREE.Uint16BufferAttribute(arr, first.itemSize) : new THREE.Float32BufferAttribute(arr, first.itemSize));
  }
  return out;
}
