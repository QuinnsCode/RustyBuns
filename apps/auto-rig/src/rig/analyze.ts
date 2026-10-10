// The rigger, in TypeScript. native/crates/auto_rig/src/lib.rs is the same
// algorithm line for line; test/parity.test.ts holds them to the same answers.
//
//   1. voxelize: rasterize triangles into a grid, seal small holes, flood the
//      outside; everything not outside is solid
//   2. thickness: distance from the surface inward; the thickest voxel is the root
//   3. geodesic: distance from the root through the solid
//   4. skeleton: slice the geodesic into bands, one node per connected piece of a
//      band (a Reeb graph), prune twigs, split long chains into bones
//   5. weights: geodesic distance through the solid from every bone; the four
//      nearest bones skin each vertex (geodesic voxel binding)
//
// Distances are integers (10 per face step, 14 per edge, 17 per corner), so
// both engines agree exactly on everything but the last float bits of weights.

export interface RigOptions {
  /** voxels along the longest side */
  resolution: number;
  /** dilations of the shell before the flood fill: seals holes ~2 voxels wide */
  seal: number;
  /** how many geodesic slices the skeleton is read from */
  bands: number;
  /** target bone length, as a fraction of the bounding box diagonal */
  boneLength: number;
  /** most bones one limb (chain between branch points) is split into */
  maxBonesPerChain: number;
  /** threads for the weight pass (Rust only; 0 = all cores) */
  threads: number;
}

export const DEFAULT_OPTIONS: RigOptions = {
  resolution: 96, seal: 1, bands: 48, boneLength: 0.12, maxBonesPerChain: 4, threads: 0,
};

/** Packed in this order for the FFI call. */
export const optionsArray = (o: RigOptions) =>
  new Float64Array([o.resolution, o.seal, o.bands, o.boneLength, o.maxBonesPerChain, o.threads]);

export interface RigTimings { voxelize: number; distance: number; skeleton: number; weights: number }

export interface RigResult {
  /** world positions of the joints, xyz per joint; joint 0 is the root */
  joints: Float32Array;
  /** parent joint index, -1 for the root */
  parents: Int32Array;
  /** four joint indices per vertex */
  skinIndex: Uint16Array;
  /** four weights per vertex, summing to 1 */
  skinWeight: Float32Array;
  grid: { dims: [number, number, number]; h: number; origin: [number, number, number]; solid: number };
  timings: RigTimings;
}

const INF = 0x3fffffff;
const RING = 18; // > the largest step weight, for Dial's bucket queue

interface Grid {
  nx: number; ny: number; nz: number; n: number; h: number;
  ox: number; oy: number; oz: number;
  /** the 26 neighbor offsets and their step weights */
  offs: Int32Array; wts: Int32Array;
}

function makeGrid(pos: Float32Array, o: RigOptions): Grid {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
  const h = Math.max(ex, ey, ez, 1e-6) / o.resolution;
  // Pad so the dilated shell never touches the border: every solid voxel then
  // has all 26 neighbors in bounds, and the outside is one connected region.
  const pad = 1.5 + o.seal;
  const nx = Math.floor(ex / h) + 4 + 2 * o.seal;
  const ny = Math.floor(ey / h) + 4 + 2 * o.seal;
  const nz = Math.floor(ez / h) + 4 + 2 * o.seal;
  const offs = new Int32Array(26), wts = new Int32Array(26);
  let k = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (m === 0) continue;
    offs[k] = dx + nx * (dy + ny * dz);
    wts[k] = m === 1 ? 10 : m === 2 ? 14 : 17;
    k++;
  }
  return { nx, ny, nz, n: nx * ny * nz, h, ox: x0 - pad * h, oy: y0 - pad * h, oz: z0 - pad * h, offs, wts };
}

function cell(g: Grid, x: number, y: number, z: number): number {
  const i = Math.min(Math.max(Math.floor((x - g.ox) / g.h), 0), g.nx - 1);
  const j = Math.min(Math.max(Math.floor((y - g.oy) / g.h), 0), g.ny - 1);
  const k = Math.min(Math.max(Math.floor((z - g.oz) / g.h), 0), g.nz - 1);
  return i + g.nx * (j + g.ny * k);
}

function rasterize(g: Grid, pos: Float32Array, idx: Uint32Array): Uint8Array {
  const shell = new Uint8Array(g.n);
  const step = g.h / 3;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const ux = pos[b] - ax, uy = pos[b + 1] - ay, uz = pos[b + 2] - az;
    const vx = pos[c] - ax, vy = pos[c + 1] - ay, vz = pos[c + 2] - az;
    const wx = vx - ux, wy = vy - uy, wz = vz - uz;
    const e = Math.max(Math.sqrt(ux * ux + uy * uy + uz * uz), Math.sqrt(vx * vx + vy * vy + vz * vz), Math.sqrt(wx * wx + wy * wy + wz * wz));
    const s = Math.min(Math.max(Math.ceil(e / step), 1), 2048);
    for (let i = 0; i <= s; i++) {
      const fu = i / s;
      for (let j = 0; j <= s - i; j++) {
        const fv = j / s;
        shell[cell(g, ax + ux * fu + vx * fv, ay + uy * fu + vy * fv, az + uz * fu + vz * fv)] = 1;
      }
    }
  }
  return shell;
}

function dilate(g: Grid, shell: Uint8Array): Uint8Array {
  const out = shell.slice();
  for (let v = 0; v < g.n; v++) if (shell[v]) for (let k = 0; k < 26; k++) out[v + g.offs[k]] = 1;
  return out;
}

/** Everything the outside can't reach through 6-connected empty voxels. */
function fillSolid(g: Grid, shell: Uint8Array): Uint8Array {
  const outside = new Uint8Array(g.n);
  const queue = new Int32Array(g.n);
  let head = 0, tail = 0;
  outside[0] = 1; queue[tail++] = 0;
  const { nx, ny, nz } = g, sxy = nx * ny;
  while (head < tail) {
    const v = queue[head++];
    const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / sxy);
    const visit = (u: number) => { if (!outside[u] && !shell[u]) { outside[u] = 1; queue[tail++] = u; } };
    if (i > 0) visit(v - 1); if (i < nx - 1) visit(v + 1);
    if (j > 0) visit(v - nx); if (j < ny - 1) visit(v + nx);
    if (k > 0) visit(v - sxy); if (k < nz - 1) visit(v + sxy);
  }
  const solid = new Uint8Array(g.n);
  for (let v = 0; v < g.n; v++) solid[v] = outside[v] ? 0 : 1;
  return solid;
}

/** Dial's algorithm: Dijkstra with integer weights, from seeds at distance d0, through solid voxels. */
function dial(g: Grid, solid: Uint8Array, dist: Int32Array, seeds: ArrayLike<number>, d0: number) {
  const buckets: number[][] = Array.from({ length: RING }, () => []);
  let pending = 0;
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    if (d0 < dist[s]) { dist[s] = d0; buckets[d0 % RING].push(s); pending++; }
  }
  const { offs, wts } = g;
  for (let cur = d0; pending > 0; cur++) {
    const b = buckets[cur % RING];
    while (b.length > 0) {
      const v = b.pop()!; pending--;
      if (dist[v] !== cur) continue;
      for (let k = 0; k < 26; k++) {
        const u = v + offs[k];
        if (!solid[u]) continue;
        const nd = cur + wts[k];
        if (nd < dist[u]) { dist[u] = nd; buckets[nd % RING].push(u); pending++; }
      }
    }
  }
}

function find(p: Int32Array, v: number): number {
  while (p[v] !== v) { p[v] = p[p[v]]; v = p[v]; }
  return v;
}

interface Chain { from: number; to: number; poly: number[] } // poly: xyz triples, world space

function buildSkeleton(g: Grid, solid: Uint8Array, geo: Int32Array, root: number, o: RigOptions, diag: number) {
  let maxG = 0;
  for (let v = 0; v < g.n; v++) if (solid[v] && geo[v] < INF && geo[v] > maxG) maxG = geo[v];
  // >= 20 so a step (<= 17) never skips a band, and every piece touches the band below
  const bw = Math.max(20, Math.ceil(maxG / o.bands));
  const band = new Int32Array(g.n).fill(-1);
  for (let v = 0; v < g.n; v++) if (solid[v] && geo[v] < INF) band[v] = Math.floor(geo[v] / bw);

  // connected pieces of each band (26-connected), visiting each neighbor pair once
  const fwd: number[] = [];
  for (let k = 0; k < 26; k++) if (g.offs[k] > 0) fwd.push(g.offs[k]);
  const uf = new Int32Array(g.n);
  for (let v = 0; v < g.n; v++) uf[v] = v;
  for (let v = 0; v < g.n; v++) {
    if (band[v] < 0) continue;
    for (const d of fwd) {
      const u = v + d;
      if (band[u] === band[v]) {
        const a = find(uf, v), b = find(uf, u);
        if (a !== b) { if (a < b) uf[b] = a; else uf[a] = b; }
      }
    }
  }
  const comp = new Int32Array(g.n).fill(-1);
  const idOf = new Int32Array(g.n).fill(-1);
  const cnt: number[] = [], sx: number[] = [], sy: number[] = [], sz: number[] = [], cband: number[] = [];
  const { nx, ny } = g;
  for (let v = 0; v < g.n; v++) {
    if (band[v] < 0) continue;
    const r = find(uf, v);
    let c = idOf[r];
    if (c < 0) { c = cnt.length; idOf[r] = c; cnt.push(0); sx.push(0); sy.push(0); sz.push(0); cband.push(band[v]); }
    comp[v] = c;
    cnt[c]++; sx[c] += v % nx; sy[c] += Math.floor(v / nx) % ny; sz[c] += Math.floor(v / (nx * ny));
  }
  const C = cnt.length;
  const pos = (c: number): [number, number, number] => [
    g.ox + (sx[c] / cnt[c] + 0.5) * g.h,
    g.oy + (sy[c] / cnt[c] + 0.5) * g.h,
    g.oz + (sz[c] / cnt[c] + 0.5) * g.h,
  ];

  // contacts between pieces of neighboring bands; each piece's parent is the
  // piece one band down it touches most
  const contact = new Map<number, number>();
  for (let v = 0; v < g.n; v++) {
    if (band[v] < 0) continue;
    for (const d of fwd) {
      const u = v + d;
      if (band[u] < 0 || Math.abs(band[u] - band[v]) !== 1) continue;
      const a = comp[v], b = comp[u];
      const key = a < b ? a * C + b : b * C + a;
      contact.set(key, (contact.get(key) ?? 0) + 1);
    }
  }
  const parent = new Int32Array(C).fill(-1), best = new Int32Array(C);
  for (const [key, n] of contact) {
    const a = Math.floor(key / C), b = key % C;
    const [child, par] = cband[a] > cband[b] ? [a, b] : [b, a];
    if (n > best[child] || (n === best[child] && par < parent[child])) { best[child] = n; parent[child] = par; }
  }
  const rootComp = comp[root];
  const kids: number[][] = Array.from({ length: C }, () => []);
  for (let c = 0; c < C; c++) if (parent[c] >= 0) kids[parent[c]].push(c); // ascending ids

  // height in bands, deepest band first
  let maxBand = 0;
  for (let c = 0; c < C; c++) if (cband[c] > maxBand) maxBand = cband[c];
  const byBand: number[][] = Array.from({ length: maxBand + 1 }, () => []);
  for (let c = 0; c < C; c++) byBand[cband[c]].push(c);
  const height = new Int32Array(C);
  for (let b = maxBand; b >= 0; b--) for (const c of byBand[b]) for (const k of kids[c]) height[c] = Math.max(height[c], height[k] + 1);

  // prune twigs: a side branch shorter than minBranch bands goes, the tallest stays
  const minBranch = Math.max(2, Math.floor(maxBand * 0.08 + 0.5));
  const kept: number[][] = Array.from({ length: C }, () => []);
  const stack = [rootComp];
  while (stack.length) {
    const c = stack.pop()!;
    let tall = -1;
    for (const k of kids[c]) if (tall < 0 || height[k] > height[tall]) tall = k;
    for (const k of kids[c]) if (k === tall || height[k] + 1 >= minBranch) kept[c].push(k);
    for (const k of kept[c]) stack.push(k);
  }

  // chains between key nodes (root, branch points, tips)
  const chains: Chain[] = [];
  const childChains = new Map<number, Chain[]>();
  const walk = [rootComp];
  while (walk.length) {
    const from = walk.pop()!;
    const list: Chain[] = [];
    for (const k of kept[from]) {
      const poly = [...pos(from)];
      let node = k;
      while (kept[node].length === 1) { poly.push(...pos(node)); node = kept[node][0]; }
      poly.push(...pos(node));
      const ch = { from, to: node, poly };
      chains.push(ch); list.push(ch);
      walk.push(node);
    }
    childChains.set(from, list);
  }

  // joints: a short chain into a branch point folds into its parent, so the
  // branches start where the chain did; everything else splits by arc length
  const target = o.boneLength * diag;
  const joints: number[] = [...pos(rootComp)];
  const parents: number[] = [-1];
  const emit = (ch: Chain, parentJoint: number) => {
    const L = polyLength(ch.poly);
    const sub = childChains.get(ch.to) ?? [];
    if (sub.length >= 2 && L < 0.5 * target) {
      for (const s of sub) emit({ from: ch.from, to: s.to, poly: [...ch.poly, ...s.poly.slice(3)] }, parentJoint);
      return;
    }
    const n = Math.min(Math.max(Math.floor(L / target + 0.5), 1), o.maxBonesPerChain);
    let prev = parentJoint;
    for (let i = 1; i <= n; i++) {
      joints.push(...pointAt(ch.poly, (L * i) / n));
      parents.push(prev);
      prev = parents.length - 1;
    }
    for (const s of sub) emit(s, prev);
  };
  for (const ch of childChains.get(rootComp) ?? []) emit(ch, 0);
  return { joints: new Float32Array(joints), parents: new Int32Array(parents), jointsF64: joints };
}

function polyLength(p: number[]): number {
  let L = 0;
  for (let i = 3; i < p.length; i += 3) {
    const dx = p[i] - p[i - 3], dy = p[i + 1] - p[i - 2], dz = p[i + 2] - p[i - 1];
    L += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return L;
}

function pointAt(p: number[], s: number): [number, number, number] {
  let acc = 0;
  for (let i = 3; i < p.length; i += 3) {
    const dx = p[i] - p[i - 3], dy = p[i + 1] - p[i - 2], dz = p[i + 2] - p[i - 1];
    const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (acc + seg >= s && seg > 0) {
      const f = (s - acc) / seg;
      return [p[i - 3] + dx * f, p[i - 2] + dy * f, p[i - 1] + dz * f];
    }
    acc += seg;
  }
  const e = p.length - 3;
  return [p[e], p[e + 1], p[e + 2]];
}

/** The voxels a segment passes through, solid ones only. */
function segmentSeeds(g: Grid, solid: Uint8Array, a: number[], b: number[]): number[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const s = Math.min(Math.max(Math.ceil(L / (g.h / 3)), 1), 65536);
  const out: number[] = [];
  for (let i = 0; i <= s; i++) {
    const f = i / s;
    const v = cell(g, a[0] + dx * f, a[1] + dy * f, a[2] + dz * f);
    if (solid[v]) out.push(v);
  }
  return out;
}

/** Distance from every bone (a joint and the segments to its children) to every vertex's voxel. */
function boneDistances(g: Grid, solid: Uint8Array, joints: number[], parents: Int32Array, vcell: Int32Array, bones: number[]): Int32Array {
  const V = vcell.length;
  const out = new Int32Array(bones.length * V);
  const dist = new Int32Array(g.n);
  for (let bi = 0; bi < bones.length; bi++) {
    const b = bones[bi];
    const seeds: number[] = [];
    for (let c = 0; c < parents.length; c++) {
      if (parents[c] !== b) continue;
      seeds.push(...segmentSeeds(g, solid, joints.slice(b * 3, b * 3 + 3), joints.slice(c * 3, c * 3 + 3)));
    }
    dist.fill(INF);
    dial(g, solid, dist, seeds, 0);
    for (let v = 0; v < V; v++) out[bi * V + v] = dist[vcell[v]];
  }
  return out;
}

/** The four nearest bones skin each vertex, weighted 1/(1+d)^4 with d in voxels. */
function skin(pos: Float32Array, joints: number[], parents: Int32Array, bones: number[], dists: Int32Array) {
  const V = pos.length / 3;
  const skinIndex = new Uint16Array(V * 4), skinWeight = new Float32Array(V * 4);
  const bd = [INF, INF, INF, INF], bb = [0, 0, 0, 0];
  for (let v = 0; v < V; v++) {
    bd.fill(INF); bb.fill(0);
    for (let bi = 0; bi < bones.length; bi++) {
      const d = dists[bi * V + v];
      if (d >= bd[3]) continue;
      let k = 3;
      while (k > 0 && d < bd[k - 1]) { bd[k] = bd[k - 1]; bb[k] = bb[k - 1]; k--; }
      bd[k] = d; bb[k] = bones[bi];
    }
    if (bd[0] >= INF) {
      // a piece the root can't reach through the solid: ride the nearest bone
      skinIndex[v * 4] = nearestBone(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], joints, parents, bones);
      skinWeight[v * 4] = 1;
      continue;
    }
    let sum = 0;
    const w = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      if (bd[k] >= INF) continue;
      const t = 1 + bd[k] / 10;
      w[k] = 1 / (t * t * t * t);
      sum += w[k];
    }
    for (let k = 0; k < 4; k++) { skinIndex[v * 4 + k] = bb[k]; skinWeight[v * 4 + k] = w[k] / sum; }
  }
  return { skinIndex, skinWeight };
}

function nearestBone(x: number, y: number, z: number, joints: number[], parents: Int32Array, bones: number[]): number {
  let best = bones[0] ?? 0, bestD = Infinity;
  for (let c = 0; c < parents.length; c++) {
    const b = parents[c];
    if (b < 0) continue;
    const ax = joints[b * 3], ay = joints[b * 3 + 1], az = joints[b * 3 + 2];
    const ux = joints[c * 3] - ax, uy = joints[c * 3 + 1] - ay, uz = joints[c * 3 + 2] - az;
    const len2 = ux * ux + uy * uy + uz * uz;
    let f = len2 > 0 ? ((x - ax) * ux + (y - ay) * uy + (z - az) * uz) / len2 : 0;
    f = Math.min(Math.max(f, 0), 1);
    const dx = ax + ux * f - x, dy = ay + uy * f - y, dz = az + uz * f - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

export function analyze(pos: Float32Array, idx: Uint32Array, opts: Partial<RigOptions> = {}): RigResult {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  o.resolution = Math.min(Math.max(Math.floor(o.resolution), 16), 320);
  o.seal = Math.min(Math.max(Math.floor(o.seal), 0), 4);
  o.bands = Math.min(Math.max(Math.floor(o.bands), 4), 256);
  o.maxBonesPerChain = Math.min(Math.max(Math.floor(o.maxBonesPerChain), 1), 8);
  if (pos.length < 9 || idx.length < 3) throw new Error("mesh has no triangles");
  const nv = Math.floor(pos.length / 3);
  for (let i = 0; i < idx.length; i++) if (idx[i] >= nv) throw new Error("index out of range");
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) throw new Error("vertex position is not finite");

  const t0 = performance.now();
  const g = makeGrid(pos, o);
  let shell = rasterize(g, pos, idx);
  for (let i = 0; i < o.seal; i++) shell = dilate(g, shell);
  const solid = fillSolid(g, shell);
  const t1 = performance.now();

  // thickness: inward from the voxels that touch the outside
  const inner = new Int32Array(g.n).fill(INF);
  const edge: number[] = [];
  const six = [1, -1, g.nx, -g.nx, g.nx * g.ny, -g.nx * g.ny];
  let solidCount = 0;
  for (let v = 0; v < g.n; v++) {
    if (!solid[v]) continue;
    solidCount++;
    for (const d of six) if (!solid[v + d]) { edge.push(v); break; }
  }
  dial(g, solid, inner, edge, 10);
  let root = -1;
  for (let v = 0; v < g.n; v++) if (solid[v] && (root < 0 || inner[v] > inner[root])) root = v;
  const geo = new Int32Array(g.n).fill(INF);
  dial(g, solid, geo, [root], 0);
  const t2 = performance.now();

  const diag = Math.sqrt((g.nx - 4 - 2 * o.seal) ** 2 + (g.ny - 4 - 2 * o.seal) ** 2 + (g.nz - 4 - 2 * o.seal) ** 2) * g.h;
  const sk = buildSkeleton(g, solid, geo, root, o, diag);
  const t3 = performance.now();

  const V = pos.length / 3;
  const vcell = new Int32Array(V);
  for (let v = 0; v < V; v++) vcell[v] = cell(g, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
  const bones: number[] = [];
  for (let j = 0; j < sk.parents.length; j++) if (sk.parents.includes(j)) bones.push(j);
  const dists = boneDistances(g, solid, sk.jointsF64, sk.parents, vcell, bones);
  const { skinIndex, skinWeight } = skin(pos, sk.jointsF64, sk.parents, bones, dists);
  const t4 = performance.now();

  return {
    joints: sk.joints, parents: sk.parents, skinIndex, skinWeight,
    grid: { dims: [g.nx, g.ny, g.nz], h: g.h, origin: [g.ox, g.oy, g.oz], solid: solidCount },
    timings: { voxelize: t1 - t0, distance: t2 - t1, skeleton: t3 - t2, weights: t4 - t3 },
  };
}
