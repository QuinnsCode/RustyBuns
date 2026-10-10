//! The rigger, in Rust. src/rig/analyze.ts is the same algorithm line for line
//! (read that file for the walkthrough); test/parity.test.ts holds the two to
//! the same answers. The one difference: the weight pass runs one bone per
//! thread here.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};
use std::time::Instant;

/// A multiply-xor hasher for integer keys; SipHash dominated the skeleton pass.
#[derive(Default)]
struct Fx(u64);
impl Hasher for Fx {
    fn finish(&self) -> u64 { self.0 }
    fn write(&mut self, bytes: &[u8]) { for &b in bytes { self.write_u64(b as u64); } }
    fn write_u64(&mut self, x: u64) { self.0 = (self.0.rotate_left(5) ^ x).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95); }
    fn write_usize(&mut self, x: usize) { self.write_u64(x as u64); }
}
type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<Fx>>;

const INF: i32 = 0x3fff_ffff;
const RING: usize = 18;

#[derive(Clone, Copy)]
pub struct Options {
    pub resolution: usize,
    pub seal: usize,
    pub bands: usize,
    pub bone_length: f64,
    pub max_bones_per_chain: usize,
    pub threads: usize,
}

impl Options {
    fn from_slice(o: &[f64]) -> Options {
        let clamp = |x: f64, lo: f64, hi: f64| x.floor().max(lo).min(hi) as usize;
        Options {
            resolution: clamp(o[0], 16.0, 320.0),
            seal: clamp(o[1], 0.0, 4.0),
            bands: clamp(o[2], 4.0, 256.0),
            bone_length: o[3],
            max_bones_per_chain: clamp(o[4], 1.0, 8.0),
            threads: clamp(o[5], 0.0, 256.0),
        }
    }
}

struct Grid {
    nx: usize,
    ny: usize,
    nz: usize,
    n: usize,
    h: f64,
    ox: f64,
    oy: f64,
    oz: f64,
    offs: [isize; 26],
    wts: [i32; 26],
}

pub struct Rig {
    pub joints: Vec<f32>,
    pub parents: Vec<i32>,
    pub skin_index: Vec<u16>,
    pub skin_weight: Vec<f32>,
    /// dims xyz, h, origin xyz, solid count, then timings: voxelize, distance, skeleton, weights (ms)
    pub info: [f64; 12],
}

fn make_grid(pos: &[f32], o: &Options) -> Grid {
    let (mut x0, mut y0, mut z0) = (f64::INFINITY, f64::INFINITY, f64::INFINITY);
    let (mut x1, mut y1, mut z1) = (f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in pos.chunks_exact(3) {
        let (x, y, z) = (p[0] as f64, p[1] as f64, p[2] as f64);
        if x < x0 { x0 = x; } if x > x1 { x1 = x; }
        if y < y0 { y0 = y; } if y > y1 { y1 = y; }
        if z < z0 { z0 = z; } if z > z1 { z1 = z; }
    }
    let (ex, ey, ez) = (x1 - x0, y1 - y0, z1 - z0);
    let h = ex.max(ey).max(ez).max(1e-6) / o.resolution as f64;
    let pad = 1.5 + o.seal as f64;
    let nx = (ex / h).floor() as usize + 4 + 2 * o.seal;
    let ny = (ey / h).floor() as usize + 4 + 2 * o.seal;
    let nz = (ez / h).floor() as usize + 4 + 2 * o.seal;
    let mut offs = [0isize; 26];
    let mut wts = [0i32; 26];
    let mut k = 0;
    for dz in -1isize..=1 {
        for dy in -1isize..=1 {
            for dx in -1isize..=1 {
                let m = dx.abs() + dy.abs() + dz.abs();
                if m == 0 { continue; }
                offs[k] = dx + nx as isize * (dy + ny as isize * dz);
                wts[k] = match m { 1 => 10, 2 => 14, _ => 17 };
                k += 1;
            }
        }
    }
    Grid { nx, ny, nz, n: nx * ny * nz, h, ox: x0 - pad * h, oy: y0 - pad * h, oz: z0 - pad * h, offs, wts }
}

impl Grid {
    fn cell(&self, x: f64, y: f64, z: f64) -> usize {
        let i = ((x - self.ox) / self.h).floor().max(0.0).min((self.nx - 1) as f64) as usize;
        let j = ((y - self.oy) / self.h).floor().max(0.0).min((self.ny - 1) as f64) as usize;
        let k = ((z - self.oz) / self.h).floor().max(0.0).min((self.nz - 1) as f64) as usize;
        i + self.nx * (j + self.ny * k)
    }
    #[inline]
    fn nb(&self, v: usize, k: usize) -> usize {
        (v as isize + self.offs[k]) as usize
    }
}

fn len3(x: f64, y: f64, z: f64) -> f64 {
    (x * x + y * y + z * z).sqrt()
}

fn rasterize(g: &Grid, pos: &[f32], idx: &[u32]) -> Vec<u8> {
    let mut shell = vec![0u8; g.n];
    let step = g.h / 3.0;
    let p = |i: u32, c: usize| pos[i as usize * 3 + c] as f64;
    for t in idx.chunks_exact(3) {
        let (ax, ay, az) = (p(t[0], 0), p(t[0], 1), p(t[0], 2));
        let (ux, uy, uz) = (p(t[1], 0) - ax, p(t[1], 1) - ay, p(t[1], 2) - az);
        let (vx, vy, vz) = (p(t[2], 0) - ax, p(t[2], 1) - ay, p(t[2], 2) - az);
        let (wx, wy, wz) = (vx - ux, vy - uy, vz - uz);
        let e = len3(ux, uy, uz).max(len3(vx, vy, vz)).max(len3(wx, wy, wz));
        let s = (e / step).ceil().max(1.0).min(2048.0) as usize;
        for i in 0..=s {
            let fu = i as f64 / s as f64;
            for j in 0..=(s - i) {
                let fv = j as f64 / s as f64;
                shell[g.cell(ax + ux * fu + vx * fv, ay + uy * fu + vy * fv, az + uz * fu + vz * fv)] = 1;
            }
        }
    }
    shell
}

fn dilate(g: &Grid, shell: &[u8]) -> Vec<u8> {
    let mut out = shell.to_vec();
    for v in 0..g.n {
        if shell[v] != 0 {
            for k in 0..26 { out[g.nb(v, k)] = 1; }
        }
    }
    out
}

fn fill_solid(g: &Grid, shell: &[u8]) -> Vec<u8> {
    let mut outside = vec![0u8; g.n];
    let mut queue = vec![0usize; g.n];
    let (mut head, mut tail) = (0, 0);
    outside[0] = 1;
    queue[tail] = 0;
    tail += 1;
    let (nx, ny, nz, sxy) = (g.nx, g.ny, g.nz, g.nx * g.ny);
    while head < tail {
        let v = queue[head];
        head += 1;
        let (i, j, k) = (v % nx, (v / nx) % ny, v / sxy);
        let mut visit = |u: usize| {
            if outside[u] == 0 && shell[u] == 0 { outside[u] = 1; queue[tail] = u; tail += 1; }
        };
        if i > 0 { visit(v - 1); } if i < nx - 1 { visit(v + 1); }
        if j > 0 { visit(v - nx); } if j < ny - 1 { visit(v + nx); }
        if k > 0 { visit(v - sxy); } if k < nz - 1 { visit(v + sxy); }
    }
    outside.iter().map(|&o| if o != 0 { 0 } else { 1 }).collect()
}

fn dial(g: &Grid, solid: &[u8], dist: &mut [i32], seeds: &[usize], d0: i32) {
    let mut buckets: Vec<Vec<usize>> = (0..RING).map(|_| Vec::new()).collect();
    let mut pending = 0usize;
    for &s in seeds {
        if d0 < dist[s] { dist[s] = d0; buckets[d0 as usize % RING].push(s); pending += 1; }
    }
    let mut cur = d0;
    while pending > 0 {
        let bi = cur as usize % RING;
        while let Some(v) = buckets[bi].pop() {
            pending -= 1;
            if dist[v] != cur { continue; }
            for k in 0..26 {
                let u = g.nb(v, k);
                if solid[u] == 0 { continue; }
                let nd = cur + g.wts[k];
                if nd < dist[u] { dist[u] = nd; buckets[nd as usize % RING].push(u); pending += 1; }
            }
        }
        cur += 1;
    }
}

fn find(p: &mut [u32], mut v: usize) -> usize {
    while p[v] as usize != v {
        p[v] = p[p[v] as usize];
        v = p[v] as usize;
    }
    v
}

struct Chain { to: usize, poly: Vec<f64> }

struct Skel { joints: Vec<f64>, parents: Vec<i32> }

fn poly_length(p: &[f64]) -> f64 {
    let mut l = 0.0;
    let mut i = 3;
    while i < p.len() {
        l += len3(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]);
        i += 3;
    }
    l
}

fn point_at(p: &[f64], s: f64) -> [f64; 3] {
    let mut acc = 0.0;
    let mut i = 3;
    while i < p.len() {
        let (dx, dy, dz) = (p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]);
        let seg = len3(dx, dy, dz);
        if acc + seg >= s && seg > 0.0 {
            let f = (s - acc) / seg;
            return [p[i - 3] + dx * f, p[i - 2] + dy * f, p[i - 1] + dz * f];
        }
        acc += seg;
        i += 3;
    }
    let e = p.len() - 3;
    [p[e], p[e + 1], p[e + 2]]
}

fn build_skeleton(g: &Grid, solid: &[u8], geo: &[i32], root: usize, o: &Options, diag: f64) -> Skel {
    let mut max_g = 0;
    for v in 0..g.n { if solid[v] != 0 && geo[v] < INF && geo[v] > max_g { max_g = geo[v]; } }
    let bw = 20.max((max_g as f64 / o.bands as f64).ceil() as i32);
    let mut band = vec![-1i32; g.n];
    for v in 0..g.n { if solid[v] != 0 && geo[v] < INF { band[v] = geo[v] / bw; } }

    let fwd: Vec<isize> = g.offs.iter().copied().filter(|&d| d > 0).collect();
    let mut uf: Vec<u32> = (0..g.n as u32).collect();
    for v in 0..g.n {
        if band[v] < 0 { continue; }
        for &d in &fwd {
            let u = (v as isize + d) as usize;
            if band[u] == band[v] {
                let (a, b) = (find(&mut uf, v), find(&mut uf, u));
                if a != b { if a < b { uf[b] = a as u32; } else { uf[a] = b as u32; } }
            }
        }
    }
    let mut comp = vec![-1i32; g.n];
    let mut id_of = vec![u32::MAX; g.n];
    let (mut cnt, mut sx, mut sy, mut sz, mut cband) = (vec![], vec![], vec![], vec![], vec![]);
    for v in 0..g.n {
        if band[v] < 0 { continue; }
        let r = find(&mut uf, v);
        if id_of[r] == u32::MAX {
            id_of[r] = cnt.len() as u32;
            cnt.push(0f64); sx.push(0f64); sy.push(0f64); sz.push(0f64); cband.push(band[v]);
        }
        let c = id_of[r] as usize;
        comp[v] = c as i32;
        cnt[c] += 1.0;
        sx[c] += (v % g.nx) as f64;
        sy[c] += ((v / g.nx) % g.ny) as f64;
        sz[c] += (v / (g.nx * g.ny)) as f64;
    }
    let nc = cnt.len();
    let pos = |c: usize| -> [f64; 3] {
        [g.ox + (sx[c] / cnt[c] + 0.5) * g.h, g.oy + (sy[c] / cnt[c] + 0.5) * g.h, g.oz + (sz[c] / cnt[c] + 0.5) * g.h]
    };

    let mut contact: FxMap<(usize, usize), i32> = FxMap::default();
    for v in 0..g.n {
        if band[v] < 0 { continue; }
        for &d in &fwd {
            let u = (v as isize + d) as usize;
            if band[u] < 0 || (band[u] - band[v]).abs() != 1 { continue; }
            let (a, b) = (comp[v] as usize, comp[u] as usize);
            *contact.entry(if a < b { (a, b) } else { (b, a) }).or_insert(0) += 1;
        }
    }
    let mut parent = vec![-1i32; nc];
    let mut best = vec![0i32; nc];
    for (&(a, b), &n) in &contact {
        let (child, par) = if cband[a] > cband[b] { (a, b) } else { (b, a) };
        if n > best[child] || (n == best[child] && (par as i32) < parent[child]) {
            best[child] = n;
            parent[child] = par as i32;
        }
    }
    let root_comp = comp[root] as usize;
    let mut kids: Vec<Vec<usize>> = vec![vec![]; nc];
    for c in 0..nc { if parent[c] >= 0 { kids[parent[c] as usize].push(c); } }

    let max_band = cband.iter().copied().max().unwrap_or(0) as usize;
    let mut by_band: Vec<Vec<usize>> = vec![vec![]; max_band + 1];
    for c in 0..nc { by_band[cband[c] as usize].push(c); }
    let mut height = vec![0i32; nc];
    for b in (0..=max_band).rev() {
        for &c in &by_band[b] {
            for &k in &kids[c] { height[c] = height[c].max(height[k] + 1); }
        }
    }

    let min_branch = 2.max((max_band as f64 * 0.08 + 0.5).floor() as i32);
    let mut kept: Vec<Vec<usize>> = vec![vec![]; nc];
    let mut stack = vec![root_comp];
    while let Some(c) = stack.pop() {
        let mut tall: Option<usize> = None;
        for &k in &kids[c] { if tall.map_or(true, |t| height[k] > height[t]) { tall = Some(k); } }
        let ks: Vec<usize> = kids[c].iter().copied().filter(|&k| Some(k) == tall || height[k] + 1 >= min_branch).collect();
        stack.extend(ks.iter().copied());
        kept[c] = ks;
    }

    let mut child_chains: HashMap<usize, Vec<Chain>> = HashMap::new();
    let mut walk = vec![root_comp];
    while let Some(from) = walk.pop() {
        let mut list = vec![];
        for &k in &kept[from] {
            let mut poly: Vec<f64> = pos(from).to_vec();
            let mut node = k;
            while kept[node].len() == 1 { poly.extend_from_slice(&pos(node)); node = kept[node][0]; }
            poly.extend_from_slice(&pos(node));
            list.push(Chain { to: node, poly });
            walk.push(node);
        }
        child_chains.insert(from, list);
    }

    let target = o.bone_length * diag;
    let mut sk = Skel { joints: pos(root_comp).to_vec(), parents: vec![-1] };
    fn emit(sk: &mut Skel, cc: &HashMap<usize, Vec<Chain>>, to: usize, poly: &[f64], parent_joint: i32, target: f64, max_per: usize) {
        let l = poly_length(poly);
        let empty = vec![];
        let sub = cc.get(&to).unwrap_or(&empty);
        if sub.len() >= 2 && l < 0.5 * target {
            for s in sub {
                let mut joined = poly.to_vec();
                joined.extend_from_slice(&s.poly[3..]);
                emit(sk, cc, s.to, &joined, parent_joint, target, max_per);
            }
            return;
        }
        let n = ((l / target + 0.5).floor().max(1.0) as usize).min(max_per);
        let mut prev = parent_joint;
        for i in 1..=n {
            sk.joints.extend_from_slice(&point_at(poly, l * i as f64 / n as f64));
            sk.parents.push(prev);
            prev = sk.parents.len() as i32 - 1;
        }
        for s in sub { emit(sk, cc, s.to, &s.poly, prev, target, max_per); }
    }
    if let Some(top) = child_chains.get(&root_comp) {
        for ch in top { emit(&mut sk, &child_chains, ch.to, &ch.poly, 0, target, o.max_bones_per_chain); }
    }
    sk
}

fn segment_seeds(g: &Grid, solid: &[u8], a: &[f64], b: &[f64], out: &mut Vec<usize>) {
    let (dx, dy, dz) = (b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let l = len3(dx, dy, dz);
    let s = (l / (g.h / 3.0)).ceil().max(1.0).min(65536.0) as usize;
    for i in 0..=s {
        let f = i as f64 / s as f64;
        let v = g.cell(a[0] + dx * f, a[1] + dy * f, a[2] + dz * f);
        if solid[v] != 0 { out.push(v); }
    }
}

/// One Dijkstra per bone, spread over threads; rows land in bone order, so
/// the result doesn't depend on the thread count.
fn bone_distances(g: &Grid, solid: &[u8], sk: &Skel, vcell: &[usize], bones: &[usize], threads: usize) -> Vec<i32> {
    let nv = vcell.len();
    let mut out = vec![0i32; bones.len() * nv];
    if nv == 0 || bones.is_empty() { return out; }
    let threads = threads.max(1).min(bones.len());
    let rows: Vec<(usize, &mut [i32])> = out.chunks_mut(nv).enumerate().collect();
    let mut per: Vec<Vec<(usize, &mut [i32])>> = (0..threads).map(|_| vec![]).collect();
    for (i, r) in rows.into_iter().enumerate() { per[i % threads].push(r); }
    std::thread::scope(|scope| {
        for work in per {
            scope.spawn(move || {
                let mut dist = vec![INF; g.n];
                let mut seeds = vec![];
                for (bi, row) in work {
                    let b = bones[bi];
                    seeds.clear();
                    for c in 0..sk.parents.len() {
                        if sk.parents[c] != b as i32 { continue; }
                        segment_seeds(g, solid, &sk.joints[b * 3..b * 3 + 3], &sk.joints[c * 3..c * 3 + 3], &mut seeds);
                    }
                    dist.fill(INF);
                    dial(g, solid, &mut dist, &seeds, 0);
                    for v in 0..nv { row[v] = dist[vcell[v]]; }
                }
            });
        }
    });
    out
}

fn nearest_bone(x: f64, y: f64, z: f64, sk: &Skel, bones: &[usize]) -> usize {
    let j = &sk.joints;
    let mut best = bones.first().copied().unwrap_or(0);
    let mut best_d = f64::INFINITY;
    for c in 0..sk.parents.len() {
        let b = sk.parents[c];
        if b < 0 { continue; }
        let b = b as usize;
        let (ax, ay, az) = (j[b * 3], j[b * 3 + 1], j[b * 3 + 2]);
        let (ux, uy, uz) = (j[c * 3] - ax, j[c * 3 + 1] - ay, j[c * 3 + 2] - az);
        let len2 = ux * ux + uy * uy + uz * uz;
        let mut f = if len2 > 0.0 { ((x - ax) * ux + (y - ay) * uy + (z - az) * uz) / len2 } else { 0.0 };
        f = f.max(0.0).min(1.0);
        let (dx, dy, dz) = (ax + ux * f - x, ay + uy * f - y, az + uz * f - z);
        let d = dx * dx + dy * dy + dz * dz;
        if d < best_d { best_d = d; best = b; }
    }
    best
}

pub fn analyze(pos: &[f32], idx: &[u32], o: Options) -> Result<Rig, &'static str> {
    if pos.len() < 9 || idx.len() < 3 { return Err("mesh has no triangles"); }
    let nv = pos.len() / 3;
    if idx.iter().any(|&i| i as usize >= nv) { return Err("index out of range"); }
    // NaN or ±Inf clamps onto the grid's border in Grid::cell, where the 26
    // neighbour offsets run off the ends of the voxel arrays and panic.
    if pos.iter().any(|x| !x.is_finite()) { return Err("vertex position is not finite"); }

    let t0 = Instant::now();
    let g = make_grid(pos, &o);
    let mut shell = rasterize(&g, pos, idx);
    for _ in 0..o.seal { shell = dilate(&g, &shell); }
    let solid = fill_solid(&g, &shell);
    drop(shell);
    let t1 = Instant::now();

    let mut inner = vec![INF; g.n];
    let six = [1isize, -1, g.nx as isize, -(g.nx as isize), (g.nx * g.ny) as isize, -((g.nx * g.ny) as isize)];
    let mut edge = vec![];
    let mut solid_count = 0usize;
    for v in 0..g.n {
        if solid[v] == 0 { continue; }
        solid_count += 1;
        if six.iter().any(|&d| solid[(v as isize + d) as usize] == 0) { edge.push(v); }
    }
    dial(&g, &solid, &mut inner, &edge, 10);
    let mut root: Option<usize> = None;
    for v in 0..g.n {
        if solid[v] != 0 && root.map_or(true, |r| inner[v] > inner[r]) { root = Some(v); }
    }
    let root = root.ok_or("no solid voxels")?;
    drop(inner);
    let mut geo = vec![INF; g.n];
    dial(&g, &solid, &mut geo, &[root], 0);
    let t2 = Instant::now();

    let s = o.seal as f64;
    let diag = (((g.nx as f64 - 4.0 - 2.0 * s).powi(2) + (g.ny as f64 - 4.0 - 2.0 * s).powi(2) + (g.nz as f64 - 4.0 - 2.0 * s).powi(2)).sqrt()) * g.h;
    let sk = build_skeleton(&g, &solid, &geo, root, &o, diag);
    drop(geo);
    let t3 = Instant::now();

    let vcell: Vec<usize> = pos.chunks_exact(3).map(|p| g.cell(p[0] as f64, p[1] as f64, p[2] as f64)).collect();
    let bones: Vec<usize> = (0..sk.parents.len()).filter(|&j| sk.parents.contains(&(j as i32))).collect();
    let threads = if o.threads == 0 { std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) } else { o.threads };
    let dists = bone_distances(&g, &solid, &sk, &vcell, &bones, threads);

    let mut skin_index = vec![0u16; nv * 4];
    let mut skin_weight = vec![0f32; nv * 4];
    for v in 0..nv {
        let mut bd = [INF; 4];
        let mut bb = [0usize; 4];
        for (bi, &bone) in bones.iter().enumerate() {
            let d = dists[bi * nv + v];
            if d >= bd[3] { continue; }
            let mut k = 3;
            while k > 0 && d < bd[k - 1] { bd[k] = bd[k - 1]; bb[k] = bb[k - 1]; k -= 1; }
            bd[k] = d;
            bb[k] = bone;
        }
        if bd[0] >= INF {
            skin_index[v * 4] = nearest_bone(pos[v * 3] as f64, pos[v * 3 + 1] as f64, pos[v * 3 + 2] as f64, &sk, &bones) as u16;
            skin_weight[v * 4] = 1.0;
            continue;
        }
        let mut w = [0f64; 4];
        let mut sum = 0.0;
        for k in 0..4 {
            if bd[k] >= INF { continue; }
            let t = 1.0 + bd[k] as f64 / 10.0;
            w[k] = 1.0 / (t * t * t * t);
            sum += w[k];
        }
        for k in 0..4 {
            skin_index[v * 4 + k] = bb[k] as u16;
            skin_weight[v * 4 + k] = (w[k] / sum) as f32;
        }
    }
    let t4 = Instant::now();
    let ms = |a: Instant, b: Instant| (b - a).as_secs_f64() * 1000.0;

    Ok(Rig {
        joints: sk.joints.iter().map(|&x| x as f32).collect(),
        parents: sk.parents,
        skin_index,
        skin_weight,
        info: [
            g.nx as f64, g.ny as f64, g.nz as f64, g.h, g.ox, g.oy, g.oz, solid_count as f64,
            ms(t0, t1), ms(t1, t2), ms(t2, t3), ms(t3, t4),
        ],
    })
}

// ---- C ABI for bun:ffi. A null handle means the mesh was rejected. ----

/// # Safety
/// pos: nverts*3 f32, idx: ntris*3 u32, opts: 6 f64 (see Options).
#[no_mangle]
pub unsafe extern "C" fn rig_analyze(pos: *const f32, nverts: u32, idx: *const u32, ntris: u32, opts: *const f64) -> *mut Rig {
    if pos.is_null() || idx.is_null() || opts.is_null() { return std::ptr::null_mut(); }
    let pos = std::slice::from_raw_parts(pos, nverts as usize * 3);
    let idx = std::slice::from_raw_parts(idx, ntris as usize * 3);
    let o = Options::from_slice(std::slice::from_raw_parts(opts, 6));
    match analyze(pos, idx, o) {
        Ok(r) => Box::into_raw(Box::new(r)),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn rig_joint_count(r: *const Rig) -> u32 {
    (*r).parents.len() as u32
}

/// # Safety
/// joints: joint_count*3 f32, parents: joint_count i32.
#[no_mangle]
pub unsafe extern "C" fn rig_joints(r: *const Rig, joints: *mut f32, parents: *mut i32) {
    let r = &*r;
    std::ptr::copy_nonoverlapping(r.joints.as_ptr(), joints, r.joints.len());
    std::ptr::copy_nonoverlapping(r.parents.as_ptr(), parents, r.parents.len());
}

/// # Safety
/// index: nverts*4 u16, weight: nverts*4 f32.
#[no_mangle]
pub unsafe extern "C" fn rig_weights(r: *const Rig, index: *mut u16, weight: *mut f32) {
    let r = &*r;
    std::ptr::copy_nonoverlapping(r.skin_index.as_ptr(), index, r.skin_index.len());
    std::ptr::copy_nonoverlapping(r.skin_weight.as_ptr(), weight, r.skin_weight.len());
}

/// # Safety
/// out: 12 f64.
#[no_mangle]
pub unsafe extern "C" fn rig_info(r: *const Rig, out: *mut f64) {
    std::ptr::copy_nonoverlapping((*r).info.as_ptr(), out, 12);
}

/// # Safety
/// r from rig_analyze, freed once.
#[no_mangle]
pub unsafe extern "C" fn rig_free(r: *mut Rig) {
    if !r.is_null() { drop(Box::from_raw(r)); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> Options { Options::from_slice(&[48.0, 1.0, 24.0, 0.12, 4.0, 1.0]) }

    /// A closed cube, 8 corners and 12 triangles, scaled by `s`.
    fn cube(s: f32) -> (Vec<f32>, Vec<u32>) {
        let mut pos = vec![];
        for i in 0..8 { pos.extend([(i & 1) as f32 * s, ((i >> 1) & 1) as f32 * s, ((i >> 2) & 1) as f32 * s]); }
        let idx = vec![0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
        (pos, idx)
    }

    #[test]
    fn rigs_a_cube() {
        let (pos, idx) = cube(1.0);
        assert!(analyze(&pos, &idx, opts()).is_ok());
    }

    #[test]
    fn rejects_an_index_past_the_vertices() {
        let (pos, mut idx) = cube(1.0);
        idx[5] = 8;
        assert!(analyze(&pos, &idx, opts()).is_err());
    }

    #[test]
    fn rejects_non_finite_positions() {
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            for v in [0, 7] {
                for c in 0..3 {
                    let (mut pos, idx) = cube(1.0);
                    pos[v * 3 + c] = bad;
                    assert!(analyze(&pos, &idx, opts()).is_err(), "{bad} at vertex {v} component {c}");
                }
            }
        }
    }

    #[test]
    fn rigs_a_mesh_at_the_edge_of_f32() {
        let (pos, idx) = cube(f32::MAX);
        assert!(analyze(&pos, &idx, opts()).is_ok());
    }
}
