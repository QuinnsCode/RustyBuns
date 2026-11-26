// The skin over a hand's bones: one smooth surface for the palm, the knuckles, the thumb's web and five tapered fingers,
// meshed once from a distance field (surface nets, then each vertex pulled onto the surface) and weighted to the
// skeleton's joints (skeleton.ts), so the grip solver bends it the way it bent the old capsules. A right hand in the
// skeleton's frame; the view mirrors it for the left. Plain numbers, no three.js.
import { FINGERS, HAND, type Finger, type V3 } from "./skeleton.ts";

/** A round cone from `a` (radius ra) to `b` (radius rb), owned by joint `bone`; `flat` < 1 squashes it top to bottom, `wide` < 1 side to side. */
type Part = { a: V3; b: V3; ra: number; rb: number; bone: number; chain: Finger | "palm"; flat: number; wide: number; k: Consts };
/** What a part's distance needs, worked out once: the cone's terms, its bounding sphere, its height's middle, its finger. */
type Consts = { ba: V3; l2: number; rr: number; a2: number; il2: number; ra: number; rb: number; c: V3; R: number; cx: number; cy: number; s: number; chain: number };

export type SkinMesh = {
  positions: Float32Array; normals: Float32Array; colors: Float32Array; index: Uint32Array;
  /** four joints and four weights per vertex, the weights summing to one */
  joints: Uint16Array; weights: Float32Array;
  /** where a nail sits on each finger's last joint, in the skeleton's frame: its middle, the way it faces, its size */
  nails: { finger: Finger; bone: number; at: V3; out: V3; along: V3; w: number; l: number }[];
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function consts(a: V3, b: V3, ra: number, rb: number, flat: number, wide: number, chain: Finger | "palm"): Consts {
  const ba = sub(b, a), l2 = dot(ba, ba), rr = ra - rb, len = Math.sqrt(l2);
  return { ba, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, ra, rb, c: mix(a, b, 0.5), R: len / 2 + Math.max(ra, rb), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, s: Math.min(flat, wide), chain: chain === "palm" ? -1 : FINGERS.indexOf(chain) };
}

/** A soft union: the two surfaces meet in a fillet about `k` wide. */
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/** The fingers are drawn a touch narrower than the bones the solver closes (their pads as deep), so side by side they don't melt together. */
const SLIM = 0.88;

function parts(): Part[] {
  const B = HAND.bones, at = (j: number) => B[j].at, out: Part[] = [];
  const palm = (a: V3, b: V3, ra: number, rb: number, flat: number) => out.push({ a, b, ra, rb, bone: 0, chain: "palm", flat, wide: 1, k: consts(a, b, ra, rb, flat, 1, "palm") });
  // The wrist, wider than deep like the forearm: a touch fuller than the forearm's end at the joint, then narrowing
  // inside it, so the two meet in a clean line and the forearm's open end stays hidden.
  palm([0.002, -0.001, 0.034], [0.003, -0.001, -0.006], 0.022, 0.03, 0.78);
  // The metacarpals fanning from the wrist to each knuckle: the back of the hand, the knuckle row and the palm under them.
  for (const f of FINGERS) {
    if (f === "thumb") continue;
    const k = at(HAND.chains[f][0]), r = B[HAND.chains[f][0]].radius;
    palm([k[0] * 0.5 + 0.004, -0.002, -0.016], [k[0], k[1] - 0.001, k[2] + 0.003], 0.0125, r * 1.08, 0.82);
  }
  // The heel of the hand on the little-finger side, and the ball of the thumb.
  palm([0.024, -0.004, -0.012], [0.03, -0.004, -0.055], 0.0125, 0.011, 0.85);
  palm([-0.006, -0.007, -0.01], [-0.019, -0.011, -0.036], 0.0145, 0.0115, 0.85);
  for (const f of FINGERS) {
    const c = HAND.chains[f], thumb = f === "thumb";
    for (let s = 0; s < 3; s++) {
      // the fingertip is a ball round the tip joint, where the solver puts the pad on what it holds
      // (the thumb lies across the hand's axes, so it keeps its girth)
      const a = at(c[s]), b = at(c[s + 1]), r1 = B[c[s]].radius, r2 = B[c[s + 1]].radius, wide = thumb ? 1 : SLIM;
      out.push({ a, b, ra: r1, rb: r2, bone: c[s], chain: f, flat: 1, wide, k: consts(a, b, r1, r2, 1, wide, f) });
    }
  }
  return out;
}

const PARTS = parts();

/** A round cone's distance (exact; after Inigo Quilez), with its constants worked out once per part. */
function roundCone(s: Part, px: number, py: number, pz: number): number {
  const { ba, l2, rr, a2, il2, ra, rb } = s.k, ax = px - s.a[0], ay = py - s.a[1], az = pz - s.a[2];
  const y = ax * ba[0] + ay * ba[1] + az * ba[2], z = y - l2;
  const qx = ax * l2 - ba[0] * y, qy = ay * l2 - ba[1] * y, qz = az * l2 - ba[2] * y, x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2, z2 = z * z * l2, k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra;
}

function partDistance(s: Part, x: number, y: number, z: number): number {
  // squash about the part's own middle: stretch the point out from it, shrink the answer back
  if (s.k.s === 1) return roundCone(s, x, y, z);
  return roundCone(s, s.k.cx + (x - s.k.cx) / s.wide, s.k.cy + (y - s.k.cy) / s.flat, z) * s.k.s;
}

/** No part is nearer than its bounding sphere (shrunk as a squashed part's answer is): a cheap floor that skips parts far from the point. */
const floor = (s: Part, x: number, y: number, z: number) => { const c = s.k.c, dx = x - c[0], dy = y - c[1], dz = z - c[2]; return (Math.sqrt(dx * dx + dy * dy + dz * dz) - s.k.R) * s.k.s; };

const chainD = new Float64Array(5);
/** How wide each fillet is: the palm's parts together, the thumb onto the palm, a finger onto it. */
const K_PALM = 0.014, K_THUMB = 0.016, K_FINGER = 0.007;

/** The hand's distance at a point: the palm's parts melted together, the thumb webbed on wide, each finger on with a small fillet. */
export function handDistance(x: number, y: number, z: number): number {
  let palm = Infinity;
  chainD.fill(Infinity);
  // The palm's parts come first. A part whose bounding sphere is further than a fillet past what is found so far can't
  // change the answer, so it is never measured.
  for (const s of PARTS) {
    const lb = floor(s, x, y, z);
    if (s.chain === "palm") {
      if (lb > palm + K_PALM) continue;
      const d = partDistance(s, x, y, z);
      palm = palm === Infinity ? d : smin(palm, d, K_PALM);
    } else {
      const i = s.k.chain;
      if (lb >= chainD[i] || lb > palm + (i === 0 ? K_THUMB : K_FINGER)) continue;
      chainD[i] = Math.min(chainD[i], partDistance(s, x, y, z));
    }
  }
  let d = smin(palm, chainD[0], K_THUMB);
  for (let i = 1; i < 5; i++) d = Math.min(d, smin(palm, chainD[i], K_FINGER));
  return d;
}

/** Which way the distance grows at `p` (four samples on a tetrahedron), and the distance there. */
function gradient(p: V3, e = 0.0003): { g: V3; d: number } {
  const [x, y, z] = p;
  const a = handDistance(x + e, y - e, z - e), b = handDistance(x - e, y - e, z + e), c = handDistance(x - e, y + e, z - e), d = handDistance(x + e, y + e, z + e);
  return { g: norm([a - b - c + d, -a - b + c + d, -a + b - c + d]), d: (a + b + c + d) / 4 };
}

/** Four joints per vertex: near a joint the two bones either side share it, so a bent knuckle bends the skin smoothly. */
const byBone = new Float64Array(HAND.bones.length);
/** A finger's joints (and the wrist) are the only ones its skin may follow; the palm's skin may follow any. */
const CHAIN_BONES = FINGERS.map((f) => new Set([0, ...HAND.chains[f]]));
function weigh(p: V3, joints: Uint16Array, weights: Float32Array, at: number) {
  let best = Infinity, chain = -1;
  byBone.fill(Infinity);
  for (const s of PARTS) {
    // a joint a centimetre further off than the nearest gets next to nothing (1/(d + 2 mm)^4): skip measuring it
    if (floor(s, p[0], p[1], p[2]) > best + 0.012) continue;
    const d = partDistance(s, p[0], p[1], p[2]);
    if (d < best) { best = d; chain = s.k.chain; }
    if (d < byBone[s.bone]) byBone[s.bone] = d;
  }
  const top: [number, number][] = [];
  for (let b = 0; b < byBone.length; b++) {
    if (byBone[b] === Infinity || (chain >= 0 && !CHAIN_BONES[chain].has(b))) continue;
    top.push([b, 1 / (Math.max(0, byBone[b]) + 0.002) ** 4]);
  }
  top.sort((x, y) => y[1] - x[1]);
  let sum = 0;
  for (let i = 0; i < 4 && i < top.length; i++) sum += top[i][1];
  for (let i = 0; i < 4; i++) { joints[at + i] = top[i]?.[0] ?? 0; weights[at + i] = top[i] ? top[i][1] / sum : 0; }
}

/** The skin's tones (sRGB): the back of the hand as the forearm, the palm lighter, the fingertips flushed. */
const SKIN: V3 = [0.71, 0.48, 0.35], PALM_TONE: V3 = [0.8, 0.56, 0.45], FLUSH: V3 = [0.76, 0.45, 0.36];

/** Each axis, and the four cells round an edge along it, anticlockwise seen from its far end. */
const AROUND = [[0, [[0, 0, 0], [0, -1, 0], [0, -1, -1], [0, 0, -1]]], [1, [[0, 0, 0], [0, 0, -1], [-1, 0, -1], [-1, 0, 0]]], [2, [[0, 0, 0], [-1, 0, 0], [-1, -1, 0], [0, -1, 0]]]] as const;

/** Mesh the hand once: a vertex per surface cell, a quad across every edge the surface crosses. */
export function buildSkin(cell = 0.0016): SkinMesh {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of PARTS) for (const [q, r] of [[s.a, s.ra], [s.b, s.rb]] as const) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q[i] - r - 0.004); hi[i] = Math.max(hi[i], q[i] + r + 0.004); }
  const n = [0, 1, 2].map((i) => Math.ceil((hi[i] - lo[i]) / cell) + 1);
  const [nx, ny, nz] = n, gi = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  const field = new Float32Array(nx * ny * nz);
  // Far from the surface only the sign matters: one sample at each 4x4x4 block's middle, and if the surface is further
  // off than the block's corners are (no distance changes faster than the point moves), the whole block takes it.
  const C = 4, h = ((C - 1) / 2) * cell, far = Math.sqrt(3) * h;
  for (let z = 0; z < nz; z += C) for (let y = 0; y < ny; y += C) for (let x = 0; x < nx; x += C) {
    const d = handDistance(lo[0] + x * cell + h, lo[1] + y * cell + h, lo[2] + z * cell + h);
    for (let dz = 0; dz < C && z + dz < nz; dz++) for (let dy = 0; dy < C && y + dy < ny; dy++) for (let dx = 0; dx < C && x + dx < nx; dx++) {
      const i = gi(x + dx, y + dy, z + dz);
      field[i] = Math.abs(d) > far ? d : handDistance(lo[0] + (x + dx) * cell, lo[1] + (y + dy) * cell, lo[2] + (z + dz) * cell);
    }
  }
  const pos: number[] = [], normal: number[] = [], cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const ci = (x: number, y: number, z: number) => x + (nx - 1) * (y + (ny - 1) * z);
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8), off = corner.map(([a, b, c]) => gi(a, b, c));
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    let inside = 0;
    const base = gi(x, y, z);
    for (let c = 0; c < 8; c++) { v[c] = field[base + off[c]]; if (v[c] < 0) inside++; }
    if (inside === 0 || inside === 8) continue;
    // the mean of where the surface crosses the cell's edges, then pulled onto the surface along its gradient
    let p: V3 = [0, 0, 0], k = 0;
    for (const [a, b] of edges) {
      if (v[a] < 0 === v[b] < 0) continue;
      const t = v[a] / (v[a] - v[b]);
      for (let i = 0; i < 3; i++) p[i] += corner[a][i] + (corner[b][i] - corner[a][i]) * t;
      k++;
    }
    p = [lo[0] + (x + p[0] / k) * cell, lo[1] + (y + p[1] / k) * cell, lo[2] + (z + p[2] / k) * cell];
    const { g, d } = gradient(p);
    normal.push(...g);
    // but never out of its own cell, or two vertices in a crease cross and fold the skin over
    const x0 = lo[0] + x * cell, y0 = lo[1] + y * cell, z0 = lo[2] + z * cell, keep = (v: number, a: number) => Math.min(a + cell, Math.max(a, v));
    p = [keep(p[0] - g[0] * d, x0), keep(p[1] - g[1] * d, y0), keep(p[2] - g[2] * d, z0)];
    cellVert[ci(x, y, z)] = pos.length / 3;
    pos.push(...p);
  }
  const index: number[] = [];
  const pt = (i: number): V3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const step = [1, nx, nx * ny], around = AROUND.map(([, q]) => q.map(([a, b, c]) => ci(a, b, c)));
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const g0 = gi(x, y, z), c0 = ci(x, y, z), here = field[g0] < 0;
    // each axis's edge out of this grid point, and the four cells round it
    for (let ax = 0; ax < 3; ax++) {
      if ((field[g0 + step[ax]] < 0) === here) continue;
      const r = around[ax], quad = [cellVert[c0 + r[0]], cellVert[c0 + r[1]], cellVert[c0 + r[2]], cellVert[c0 + r[3]]];
      if (quad[0] < 0 || quad[1] < 0 || quad[2] < 0 || quad[3] < 0) continue;
      // the cells go round the edge anticlockwise looking down it, so the quad faces along the edge: out, if it starts inside
      const out = here ? quad : [quad[0], quad[3], quad[2], quad[1]];
      index.push(out[0], out[1], out[2], out[0], out[2], out[3]);
    }
  }
  const count = pos.length / 3, normals = new Float32Array(normal), colors = new Float32Array(count * 3);
  const joints = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
  const tips = FINGERS.map((f) => HAND.bones[HAND.tips[f]].at);
  for (let i = 0; i < count; i++) {
    const p = pt(i), g: V3 = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
    // the palm side lighter, the fingertips a little flushed
    const tip = Math.min(...tips.map((t) => Math.hypot(...sub(p, t))));
    let col = mix(SKIN, PALM_TONE, Math.max(0, -g[1]) * 0.6);
    col = mix(col, FLUSH, Math.max(0, 1 - tip / 0.016) * 0.5);
    // vertex colours are linear light; these tones are picked as sRGB
    colors.set(col.map((c) => c ** 2.2), i * 3);
    weigh(p, joints, weights, i * 4);
  }
  return { positions: new Float32Array(pos), normals, colors, index: new Uint32Array(index), joints, weights, nails: nails() };
}

/** A nail on the back of each last segment, near its end. */
function nails(): SkinMesh["nails"] {
  return FINGERS.map((f) => {
    const c = HAND.chains[f], bone = c[2], a = HAND.bones[bone].at, b = HAND.bones[c[3]].at, deep = HAND.bones[bone].radius, r = deep * (f === "thumb" ? 1 : SLIM);
    const along = norm(sub(b, a)), len = Math.hypot(...sub(b, a));
    // the back of the finger is +y; the thumb's nail looks out and up, away from the palm
    const want: V3 = f === "thumb" ? [-0.55, 0.8, 0] : [0, 1, 0], k = dot(want, along);
    const out = norm([want[0] - along[0] * k, want[1] - along[1] * k, want[2] - along[2] * k]);
    const mid = mix(a, b, 0.6), at: V3 = [mid[0] + out[0] * deep * 0.66, mid[1] + out[1] * deep * 0.66, mid[2] + out[2] * deep * 0.66];
    return { finger: f, bone, at, out, along, w: r * 1.3, l: len * 0.75 };
  });
}
