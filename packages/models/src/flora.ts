// Plants, built from a seed: shrubs, saguaros, barrel cacti and prickly pear. Each is one flat-shaded
// BufferGeometry with its colours in a `color` attribute, origin at the foot, y up, in metres, so an app draws
// every copy of one in a single instanced mesh (vertexColors on, instance colours to tint each copy).
// The same seed always grows the same plant.
//
//   shrub     about 2 m across and 1.4 m tall: leafy clumps over a dark core, deep green low down and lit on
//             top, a couple of twigs poking out; `wide` spreads it, `berries` dots red berries on it
//   saguaro   a ribbed column 6-7 m tall, two or three arms that elbow up, cream flowers on the crowns
//   barrel    a squat ribbed barrel cactus under a ring of yellow flowers
//   pear      prickly pear: flat pads growing out of pads, magenta fruit on the tips
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "@rustybuns/util";

export const FLORA_COLORS = {
  leaf: "#5f8a3a", leafLit: "#86a948", leafDeep: "#3a5a2a", twig: "#5a4030", berry: "#b8323a",
  cactus: "#5f8a52", bloom: "#f4ecd0", bloomEye: "#e6b93a", pad: "#7aa457", fruit: "#b0306a",
};
type Hue = keyof typeof FLORA_COLORS;

/** Positions, a flat normal per face and one colour, with nothing else, so the pieces of a plant merge. */
function finish(geo: THREE.BufferGeometry, hue: Hue): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(flat.attributes)) if (k !== "position") flat.deleteAttribute(k);
  flat.computeVertexNormals();
  const c = new THREE.Color(FLORA_COLORS[hue]), n = flat.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  flat.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return flat;
}

const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;

/** A smooth bump field over directions: a few seeded waves, so a lump is the same wherever its corners repeat. */
function bumps(rand: () => number, k = 6) {
  const waves = Array.from({ length: k }, () => {
    const d = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    return { d, f: 1.5 + rand() * 3, p: rand() * 6.28 };
  });
  return (n: THREE.Vector3) => waves.reduce((s, w) => s + Math.sin(n.dot(w.d) * w.f + w.p), 0) / Math.sqrt(k);
}

/** A crinkle from a direction alone (a hash, not a random draw), so a corner shared by faces moves once. */
const crinkleAt = (n: THREE.Vector3) => {
  const h = Math.sin(n.x * 127.1 + n.y * 311.7 + n.z * 74.7) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
};

/** A lumpy clump: an icosahedron pushed in and out, sliced flat at `floor`. */
function blob(rand: () => number, hue: Hue, at: THREE.Vector3, r: THREE.Vector3, detail = 1, bump = 0.25, crinkle = 0, floor = -Infinity) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const field = bumps(rand), pos = geo.attributes.position, n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    const k = 1 + bump * field(n) + crinkle * crinkleAt(n);
    pos.setXYZ(i, at.x + n.x * r.x * k, Math.max(floor, at.y + n.y * r.y * k), at.z + n.z * r.z * k);
  }
  return finish(geo, hue);
}

/** Rings along a path of [x, y, z, radius] points, each square to the path so arms can bend; `ribs` grooves it
 * into that many ribs, `cap` domes the far end. */
function tube(hue: Hue, path: [number, number, number, number][], seg: number, ribs = 0, rib = 0, cap = true) {
  const pts = path.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const rows: THREE.Vector3[][] = [];
  let side: THREE.Vector3 | null = null;
  pts.forEach((p, i) => {
    const t = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
    // carry the frame along the path so the rings don't twist
    side = side ? side.clone().addScaledVector(t, -side.dot(t)).normalize()
      : t.clone().cross(Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const other = t.clone().cross(side);
    rows.push(Array.from({ length: seg }, (_, j) => {
      const a = (2 * Math.PI * j) / seg, k = ribs ? 1 - rib * (0.5 - 0.5 * Math.cos(ribs * a)) : 1;
      return p.clone().addScaledVector(side!, Math.cos(a) * path[i][3] * k).addScaledVector(other, Math.sin(a) * path[i][3] * k);
    }));
  });
  const v: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => v.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j < seg; j++) {
    const a = rows[i][j], b = rows[i][(j + 1) % seg], c = rows[i + 1][(j + 1) % seg], d = rows[i + 1][j];
    tri(a, b, c); tri(a, c, d);
  }
  if (cap) {
    const last = rows.at(-1)!, dir = pts.at(-1)!.clone().sub(pts.at(-2)!).normalize();
    const tip = pts.at(-1)!.clone().addScaledVector(dir, path.at(-1)![3] * 0.55);
    for (let j = 0; j < seg; j++) tri(last[j], last[(j + 1) % seg], tip);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  return finish(geo, hue);
}

/** A star of petals facing up, at `at`. */
function flower(hue: Hue, at: THREE.Vector3, r: number, petals = 5) {
  const v: number[] = [];
  for (let j = 0; j < petals * 2; j++) {
    const ra = j % 2 ? r * 0.45 : r, rb = j % 2 ? r : r * 0.45;
    const a = (Math.PI * j) / petals, b = (Math.PI * (j + 1)) / petals;
    v.push(at.x + Math.cos(a) * ra, at.y, at.z + Math.sin(a) * ra, at.x, at.y + r * 0.3, at.z, at.x + Math.cos(b) * rb, at.y, at.z + Math.sin(b) * rb);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  return finish(geo, hue);
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function shrub(seed: number, { wide = 1, berries = false } = {}): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const parts = [blob(rand, "leafDeep", V(0, 0.5, 0), V(0.82 * wide, 0.6, 0.82 * wide), 2, 0.12, 0, 0)];
  const lobes: [THREE.Vector3, number][] = [];
  const n = 22;
  for (let k = 0; k < n; k++) {
    // Fibonacci points over the upper part of a dome, so the clumps cover it evenly
    const e = Math.asin(0.05 + (0.95 * (k + 0.5)) / n), up = Math.sin(e);
    const a = k * 2.39996 + (rand() - 0.5) * 0.5, d = Math.cos(e) * 0.74 * wide;
    const at = V(Math.cos(a) * d, 0.38 + up * 0.7, Math.sin(a) * d), r = (0.27 + rand() * 0.1) * (1.15 - 0.3 * up);
    parts.push(blob(rand, up > 0.72 ? "leafLit" : up > 0.3 ? "leaf" : "leafDeep", at, V(r, r * 0.8, r), 1, 0.3, 0.12, 0));
    lobes.push([at, r]);
  }
  for (let k = 0; k < 2; k++) {
    const a = rand() * Math.PI * 2, c = Math.cos(a) * wide, s = Math.sin(a) * wide;
    parts.push(tube("twig", [[c * 0.3, 0.9, s * 0.3, 0.022], [c * 0.55, 1.28, s * 0.55, 0.01]], 4, 0, 0, false));
  }
  if (berries) {
    // in bunches of three on the outside of every other clump
    lobes.filter((_, i) => i % 2 === 0 && i > 0).forEach(([at, r]) => {
      const out = V(at.x, at.y - 0.45, at.z).normalize();
      for (let j = 0; j < 3; j++) {
        const q = at.clone().addScaledVector(out, r * 0.95).add(V(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.12));
        parts.push(blob(rand, "berry", q, V(0.05, 0.05, 0.05), 0, 0));
      }
    });
  }
  return merge(parts);
}

const RIBS = 10;

/** An arm: out of the trunk sideways along (ox, oz), elbowing up through a quarter turn, then `up` metres more. */
function arm(x: number, y: number, z: number, ox: number, oz: number, up: number, r0: number, r1: number) {
  const reach = Math.hypot(ox, oz), pts: [number, number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push([x + ox * Math.sin(a), y + (1 - Math.cos(a)) * reach * 0.9, z + oz * Math.sin(a), r0 + ((r1 - r0) * i) / 6]);
  }
  const [ex, ey, ez] = pts.at(-1)!;
  return [...pts, [ex, ey + up * 0.5, ez, r1], [ex, ey + up, ez, r1 * 0.95]] as [number, number, number, number][];
}

export function saguaro(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const h = 6 + rand(), r = 0.32;
  const parts = [tube("cactus", [[0, 0, 0, r * 1.05], [0, h * 0.15, 0, r], [0, h * 0.7, 0, r * 0.97], [0, h * 0.94, 0, r * 0.9]], RIBS * 2, RIBS, 0.16)];
  const crowns: [THREE.Vector3, number][] = [[V(0, h * 0.94 + r * 0.5, 0), r]];
  const arms = 2 + Math.floor(rand() * 2), turn = rand() * Math.PI * 2;
  for (let k = 0; k < arms; k++) {
    const a = turn + (k * 2 * Math.PI) / arms + (rand() - 0.5) * 0.8, out = 0.7 + rand() * 0.25;
    const path = arm(0, h * (0.38 + rand() * 0.24), 0, Math.cos(a) * out, Math.sin(a) * out, 0.9 + rand() * 0.7, r * 0.78, r * 0.72);
    parts.push(tube("cactus", path, RIBS * 2 - 4, RIBS - 2, 0.16));
    const [x, y, z, rr] = path.at(-1)!;
    crowns.push([V(x, y + rr * 0.5, z), rr]);
  }
  for (const [c, rr] of crowns) {
    for (let j = 0, n = 2 + Math.floor(rand() * 3); j < n; j++) {
      const a = rand() * Math.PI * 2, d = rr * (0.1 + rand() * 0.35);
      const at = V(c.x + Math.cos(a) * d, c.y - rr * 0.18, c.z + Math.sin(a) * d);
      parts.push(flower("bloom", at, 0.11), blob(rand, "bloomEye", at.clone().setY(at.y + 0.05), V(0.035, 0.03, 0.035), 0, 0));
    }
  }
  return merge(parts);
}

export function barrel(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const parts = [tube("cactus", [[0, 0, 0, 0.32], [0, 0.15, 0, 0.4], [0, 0.38, 0, 0.42], [0, 0.6, 0, 0.36], [0, 0.72, 0, 0.24]], 28, 14, 0.2)];
  for (let j = 0; j < 7; j++) {
    const a = (2 * Math.PI * j) / 7 + (rand() - 0.5) * 0.4;
    parts.push(flower("bloomEye", V(Math.cos(a) * 0.17, 0.76, Math.sin(a) * 0.17), 0.08, 6));
  }
  return merge(parts);
}

export function pear(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  /** A pad: a flattened lump centred on `at`, turned `yaw` and leaning `tilt`. Returns where its top is. */
  const pad = (at: THREE.Vector3, yaw: number, tilt: number, size: number) => {
    const turn = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z)
      .multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeRotationZ(tilt));
    parts.push(blob(rand, "pad", V(0, 0, 0), V(size * 0.78, size, 0.07), 1, 0.06).applyMatrix4(turn));
    return V(0, size * 0.9, 0).applyMatrix4(turn);
  };
  const lean = (yaw: number, tilt: number, len: number) => V(0, len, 0).applyAxisAngle(V(0, 0, 1), tilt).applyAxisAngle(V(0, 1, 0), yaw);
  const tips: THREE.Vector3[] = [];
  for (let base = 0; base < 3; base++) {
    const yaw = base * 2.1 + (rand() - 0.5) * 0.6, tilt = (rand() - 0.5) * 0.6;
    const top = pad(V(Math.cos(yaw) * 0.15, 0.36, Math.sin(yaw) * 0.15), yaw, tilt, 0.38);
    for (let up = 0; up < 2; up++) {
      const t2 = tilt + (up ? 0.5 : -0.5) + (rand() - 0.5) * 0.4, y2 = yaw + (rand() - 0.5) * 1.2;
      let tip = pad(top.clone().addScaledVector(lean(y2, t2, 0.3), 0.85), y2, t2, 0.3);
      if (rand() < 0.6) tip = pad(tip.clone().addScaledVector(lean(y2, t2 * 0.5, 0.22), 0.85), y2 + 0.4, t2 * 0.5, 0.22);
      tips.push(tip);
    }
  }
  for (const t of tips) parts.push(blob(rand, "fruit", t.clone().setY(t.y + 0.03), V(0.05, 0.07, 0.05), 0, 0));
  return merge(parts);
}
