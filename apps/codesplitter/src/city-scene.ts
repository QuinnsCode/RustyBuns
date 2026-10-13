// The code city's postcard scene (card.ts draws the frame): a rainy night in miniature. Districts are
// floating slabs of rock and wet asphalt; files are towers with lit windows, grime, neon and rooftop
// clutter; recent lines light a tower up. Drawn by hand into a float buffer (no image library), then
// bloomed, tilt-shifted and grained.

import type { CityCard } from "./card.ts";

type RGB = [number, number, number];
type Pt = [number, number];

const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
function hash(a: number, b = 0, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const vnoise = (x: number, y: number, s: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x: number, y: number, s: number) => { let t = 0, a = 0.5; for (let o = 0; o < 4; o++) { t += a * vnoise(x, y, s); x *= 2; y *= 2; a /= 2; } return t / 0.9375; };

const HAZE: RGB = [44, 26, 60];
const NEON: RGB[] = [[255, 60, 170], [60, 220, 255], [255, 170, 40], [90, 255, 150], [255, 60, 70]];
const LIT: RGB[] = [[255, 196, 110], [255, 205, 130], [150, 215, 255], [210, 255, 230], [255, 120, 190]];
const WALLS: RGB[] = [[70, 72, 78], [88, 58, 50], [54, 64, 84], [84, 76, 62]];
const GLASS: RGB = [22, 30, 44], CARS: RGB[] = [[120, 30, 34], [150, 150, 155], [215, 170, 30], [30, 60, 110], [30, 32, 36]];
const UMBRELLAS: RGB[] = [[210, 40, 70], [40, 150, 210], [225, 185, 40], [130, 70, 190]];
const GAP = 1.6;   // an alley, layout()'s CELL minus FOOT in city.ts

class Pix {
  d: Float32Array;
  row: Float32Array;
  constructor(readonly W: number, readonly H: number) { this.d = new Float32Array(W * H * 3); this.row = new Float32Array(W); }
  /** Fill a convex polygon, antialiased (three sub-scanlines a row); `add` lights instead of covers. */
  quad(pts: Pt[], c: RGB, a = 1, add = false) {
    const { W, H, d, row } = this, ys = pts.map((p) => p[1]), SUB = 3;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(H, Math.ceil(Math.max(...ys))); y++) {
      let mn = W, mx = -1;
      for (let k = 0; k < SUB; k++) {
        const sy = y + (k + 0.5) / SUB;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < pts.length; i++) {
          const [x0, y0] = pts[i]!, [x1, y1] = pts[(i + 1) % pts.length]!;
          if ((y0 <= sy && sy < y1) || (y1 <= sy && sy < y0)) { const x = x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0); if (x < lo) lo = x; if (x > hi) hi = x; }
        }
        for (let x = Math.max(0, Math.floor(lo)); x < Math.min(W, Math.ceil(hi)); x++) {
          row[x]! += (Math.min(hi, x + 1) - Math.max(lo, x)) / SUB;
          if (x < mn) mn = x; if (x > mx) mx = x;
        }
      }
      for (let x = mn; x <= mx; x++) {
        const t = Math.min(1, row[x]!) * a, o = (y * W + x) * 3;
        row[x] = 0;
        if (add) { d[o]! += c[0] * t; d[o + 1]! += c[1] * t; d[o + 2]! += c[2] * t; }
        else { d[o]! += (c[0] - d[o]!) * t; d[o + 1]! += (c[1] - d[o + 1]!) * t; d[o + 2]! += (c[2] - d[o + 2]!) * t; }
      }
    }
  }
  line(a: Pt, b: Pt, w: number, c: RGB, al = 1, add = false) {
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, px = (-dy / n) * w / 2, py = (dx / n) * w / 2;
    this.quad([[a[0] + px, a[1] + py], [b[0] + px, b[1] + py], [b[0] - px, b[1] - py], [a[0] - px, a[1] - py]], c, al, add);
  }
  glow(cx: number, cy: number, rx: number, ry: number, c: RGB, k: number) {
    const { W, H, d } = this;
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++)
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry, q = dx * dx + dy * dy;
        if (q >= 1) continue;
        const w = (1 - q) * (1 - q) * k, o = (y * W + x) * 3;
        d[o]! += c[0] * w; d[o + 1]! += c[1] * w; d[o + 2]! += c[2] * w;
      }
  }
  /** A streak of rain, brightest at its head. */
  rain(x: number, y: number, len: number, c: RGB, a: number) {
    const { W, H, d } = this;
    for (let t = 0; t < len; t++) {
      const px = Math.round(x - t * 0.18), py = Math.round(y + t);
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      const k = a * (1 - t / len), o = (py * W + px) * 3;
      d[o]! += (c[0] - d[o]!) * k; d[o + 1]! += (c[1] - d[o + 1]!) * k; d[o + 2]! += (c[2] - d[o + 2]!) * k;
    }
  }
}

/** Separable box blur on a w x h float image of 3 channels. */
function blur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let k = 0; k < 3; k++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[(y * w + clamp(x, 0, w - 1)) * 3 + k]!;
    for (let x = 0; x < w; x++) {
      tmp[(y * w + x) * 3 + k] = sum / n;
      sum += src[(y * w + Math.min(w - 1, x + r + 1)) * 3 + k]! - src[(y * w + Math.max(0, x - r)) * 3 + k]!;
    }
  }
  for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[(clamp(y, 0, h - 1) * w + x) * 3 + k]!;
    for (let y = 0; y < h; y++) {
      out[(y * w + x) * 3 + k] = sum / n;
      sum += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + k]! - tmp[(Math.max(0, y - r) * w + x) * 3 + k]!;
    }
  }
  return out;
}

/** Paint the city across the whole W x H frame as 8-bit RGB into `out`; the caller lays its header and footer over the top and bottom. */
export function paintCity(out: Uint8Array, W: number, H: number, city: CityCard, top: number, bottom: number) {
  const px = new Pix(W, H), seed = [...city.name].reduce((n, ch) => (Math.imul(n, 31) + ch.charCodeAt(0)) | 0, 7);

  // ---- sky: a bruised gradient, low cloud lit by the city, a far skyline, rain ----
  const SKY_T: RGB = [5, 8, 16], SKY_M: RGB = [16, 15, 32], SKY_B: RGB = [46, 24, 52];
  for (let y = 0; y < H; y++) {
    const t = y / H, base = t < 0.5 ? mix(SKY_T, SKY_M, t / 0.5) : mix(SKY_M, SKY_B, (t - 0.5) / 0.5);
    for (let x = 0; x < W; x++) px.d.set(base, (y * W + x) * 3);
  }
  for (let y = 0; y < 360; y += 2) for (let x = 0; x < W; x += 2) {
    const n = fbm(x / 230, y / 90, seed), cover = clamp((n - (0.46 + (y / 360) * 0.22)) / 0.18) * (1 - clamp(y / 360) * 0.6);
    if (cover <= 0) continue;
    const col = mix([24, 26, 40], [96, 70, 118], clamp(fbm(x / 110, y / 60, seed + 1) * 1.3 - 0.25));
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const o = ((y + dy) * W + x + dx) * 3;
      for (let k = 0; k < 3; k++) px.d[o + k]! += (col[k]! - px.d[o + k]!) * cover * 0.85;
    }
  }
  const horizon = Math.round(H * 0.74);
  for (const [layer, tone, lo, hi] of [[0, [30, 20, 46], 40, 150], [1, [18, 13, 32], 30, 120]] as [number, RGB, number, number][]) {
    for (let x = -10, i = 0; x < W; i++) {
      const w = 14 + hash(seed, i, layer) * 24, h = lo + hash(seed, i, layer + 5) * (hi - lo), y0 = horizon - h + layer * 12;
      px.quad([[x, y0], [x + w, y0], [x + w, H], [x, H]], tone);
      for (let wy = y0 + 6; wy < horizon + layer * 12 - 4; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 5)
        if (hash(seed + wx, wy, layer) < 0.13) px.quad([[wx, wy], [wx + 2, wy], [wx + 2, wy + 3], [wx, wy + 3]], hash(wx, wy) < 0.7 ? [200, 160, 110] : [120, 210, 255], 0.55);
      x += w + hash(seed, i, 9) * 6;
    }
    px.quad([[0, horizon - 200 + layer * 12], [W, horizon - 200 + layer * 12], [W, H], [0, H]], HAZE, 0.0);
  }
  px.glow(W / 2, horizon + 10, 620, 190, [120, 44, 96], 0.55);
  for (let i = 0; i < 340; i++) px.rain(hash(seed, i, 1) * (W + 80), hash(seed, i, 2) * H, 10 + hash(seed, i, 3) * 14, [150, 170, 205], 0.1 + hash(seed, i, 4) * 0.16);

  // ---- the city ----
  const all = city.districts.flatMap((d) => d.buildings);
  if (!all.length) return finish(px, out, W, H, seed);
  const iso = (x: number, z: number, y = 0): Pt => [(x - z) * 0.866, (x + z) * 0.5 - y];
  const sq = (h: number) => 2.1 * Math.sqrt(h);
  const slab = (size: number) => 3 + size * 0.12;
  const corners = city.districts.flatMap((d) => [iso(d.x, d.z), iso(d.x + d.size, d.z), iso(d.x, d.z + d.size), iso(d.x + d.size, d.z + d.size), iso(d.x + d.size / 2, d.z + d.size / 2, -slab(d.size))])
    .concat(all.map((b) => iso(b.x - b.w / 2, b.z - b.w / 2, sq(b.h) + 4)));
  const [x0, x1] = [Math.min(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[1]))];
  const s = Math.min((W - 140) / Math.max(1, x1 - x0), (bottom - top) / Math.max(1, y1 - y0));
  const P = (x: number, z: number, y = 0): Pt => { const p = iso(x, z, y); return [W / 2 + (p[0] - (x0 + x1) / 2) * s, bottom - (y1 - p[1]) * s]; };
  const keys = all.map((b) => b.x + b.z), kMin = Math.min(...keys), kMax = Math.max(...keys, kMin + 1);
  const fogAt = (key: number) => 0.38 * (1 - (key - kMin) / (kMax - kMin));

  /** A box standing on the ground: left and right faces, a roof. `win` puts windows and grime on the faces. */
  const box = (cx: number, cz: number, rx: number, rz: number, ya: number, yb: number, o: { wall: RGB; fog: number; glass?: boolean; lit?: number; id: number; windows?: boolean; shop?: boolean }) => {
    const hh = (yb - ya) * s, faces: [Pt, Pt, number][] = [[P(cx - rx, cz + rz, ya), P(cx + rx, cz + rz, ya), 0.8], [P(cx + rx, cz + rz, ya), P(cx + rx, cz - rz, ya), 0.5]];
    faces.forEach(([p, q, light], f) => {
      const at = (a: number, b: number): Pt => [p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a - hh * b];
      const wall = mix(mul(o.wall, light), HAZE, o.fog);
      px.quad([at(0, 0), at(1, 0), at(1, 1), at(0, 1)], wall);
      // Wet brightness from the street below, falling off up the wall.
      for (let k = 0; k < 4; k++) px.quad([at(0, k / 4), at(1, k / 4), at(1, (k + 1) / 4 + 0.02), at(0, (k + 1) / 4 + 0.02)], mul(wall, 1.3 - k * 0.2), 0.45);
      if (!o.windows) return;
      // Grime: rain runoff streaks, a rust-dark band under the roof.
      for (let g = 0; g < 4; g++) {
        const u = hash(o.id, f, g), len = 0.15 + hash(o.id, f, g + 9) * 0.45;
        px.quad([at(u, 1), at(u + 0.05, 1), at(u + 0.05, 1 - len), at(u, 1 - len)], [8, 8, 12], 0.28);
      }
      px.quad([at(0, 0.965), at(1, 0.965), at(1, 1), at(0, 1)], [10, 10, 14], 0.4);
      const seams = Math.max(1, Math.floor((yb - ya) / 1.05));
      for (let j = 1; j < seams; j++) px.line(at(0, 0.08 + (j / seams) * 0.89 - 0.02), at(1, 0.08 + (j / seams) * 0.89 - 0.02), 1, [6, 6, 10], 0.3);
      const pipe = 0.04 + hash(o.id, f, 77) * 0.1;
      px.line(at(pipe, 0), at(pipe, 1), 1.2, [20, 20, 26], 0.6);
      for (let g = 0; g < 14; g++) { const a = at(hash(o.id, f, g + 100), hash(o.id, f, g + 120)); px.quad([a, [a[0] + 1.2, a[1]], [a[0] + 1.2, a[1] + 1.2], [a[0], a[1] + 1.2]], hash(o.id, g, f) < 0.5 ? [8, 8, 12] : [110, 96, 84], 0.22); }
      const nf = Math.max(1, Math.floor((yb - ya) / 1.05)), nc = Math.max(2, Math.floor((o.glass ? rx : f ? rz : rx) * 2 / 0.6)), lit = o.lit ?? 0;
      for (let j = 0; j < nf; j++) {
        const floorOn = 0.55 + hash(o.id, j, 40 + f) * 0.9;
        const v0 = 0.08 + ((j + 0.2) / nf) * 0.89, v1 = 0.08 + ((j + 0.8) / nf) * 0.89;
        if (o.glass) {
          // A curtain wall: bands of cyan and violet, some floors dark.
          if (hash(o.id, j, f + 70) < 0.55 * floorOn) px.quad([at(0.05, v0), at(0.95, v0), at(0.95, v1), at(0.05, v1)], hash(o.id, j, 3) < 0.6 ? [70, 210, 255] : [170, 100, 255], 0.85);
          continue;
        }
        if (j === 0 && o.shop) {
          const c = LIT[Math.floor(hash(o.id, f, 11) * LIT.length)]!;
          for (let i = 0; i < nc; i++) px.quad([at((i + 0.1) / nc, 0.03), at((i + 0.9) / nc, 0.03), at((i + 0.9) / nc, 0.5 / nf + 0.05), at((i + 0.1) / nc, 0.5 / nf + 0.05)], c, 0.92);
          continue;
        }
        for (let i = 0; i < nc; i++) {
          const on = hash(o.id, i * 31 + f, j) < (0.28 + lit * 0.35) * floorOn;
          const u0 = (i + 0.2) / nc, u1 = (i + 0.8) / nc;
          if (on) px.quad([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], mul(LIT[Math.floor(hash(o.id, i, j * 7 + f) ** 1.6 * LIT.length)]!, 0.65 + hash(o.id, j, i) * 0.4), 0.95);
          else px.quad([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], hash(o.id, i, j + 99) < 0.12 ? [64, 84, 112] : [16, 22, 34], 0.85);
        }
      }
    });
    const roof = mix([34, 36, 44], HAZE, o.fog);
    px.quad([P(cx - rx, cz - rz, yb), P(cx + rx, cz - rz, yb), P(cx + rx, cz + rz, yb), P(cx - rx, cz + rz, yb)], roof);
    px.line(P(cx - rx, cz + rz, yb), P(cx + rx, cz + rz, yb), 1.2, [120, 128, 146], 0.5 * (1 - o.fog));
    px.line(P(cx + rx, cz + rz, yb), P(cx + rx, cz - rz, yb), 1.2, [120, 128, 146], 0.4 * (1 - o.fog));
    return faces;
  };

  type Item = { key: number; draw(): void };
  for (const d of [...city.districts].sort((a, b) => a.x + a.z - (b.x + b.z))) {
    const T = slab(d.size), inset = d.size * 0.14, cx = d.x + d.size / 2, cz = d.z + d.size / 2, did = Math.floor(d.x * 7 + d.z * 13);
    // Rock and concrete underneath, lit from below by the city's own glow.
    const rim = (a: Pt, b: Pt, a2: Pt, b2: Pt, f: number) => {
      const at = (u: number, v: number): Pt => {
        const tx = a[0] + (b[0] - a[0]) * u, ty = a[1] + (b[1] - a[1]) * u, bx = a2[0] + (b2[0] - a2[0]) * u, by = a2[1] + (b2[1] - a2[1]) * u;
        return [tx + (bx - tx) * v, ty + (by - ty) * v];
      };
      px.quad([a, b, b2, a2], [60, 50, 46]);
      for (let k = 0; k < 14; k++) {
        const v0 = k / 14, v1 = Math.min(1, (k + 1.3) / 14), col = k === 0 ? [96, 98, 108] as RGB : mix([74, 60, 52], [26, 22, 30], v0);
        px.quad([at(0, v0), at(1, v0), at(1, v1), at(0, v1)], mul(col, (f ? 0.6 : 0.85) * (0.82 + hash(did, k, f) * 0.36)));
      }
      for (let k = 0; k < 9; k++) {   // cracks and strata
        const u = hash(did, k, f + 5), v = 0.15 + hash(did, k, f + 6) * 0.7;
        px.line(at(u, v), at(Math.min(1, u + 0.12), v + 0.08), 1, [10, 8, 12], 0.5);
      }
    };
    const D = P(d.x + inset, d.z + d.size - inset, -T), Cc = P(d.x + d.size - inset, d.z + d.size - inset, -T), Bb = P(d.x + d.size - inset, d.z + inset, -T);
    rim(P(d.x, d.z + d.size), P(d.x + d.size, d.z + d.size), D, Cc, 0);
    rim(P(d.x + d.size, d.z + d.size), P(d.x + d.size, d.z), Cc, Bb, 1);
    const under = P(cx, cz, -T - 1);
    px.glow(under[0], under[1], d.size * s * 0.8, d.size * s * 0.3, [120, 50, 170], 0.35);
    // The street: curb, wet asphalt, puddles.
    const slabTop = (m: number, c: RGB, a = 1) => px.quad([P(d.x + m, d.z + m), P(d.x + d.size - m, d.z + m), P(d.x + d.size - m, d.z + d.size - m), P(d.x + m, d.z + d.size - m)], c, a);
    slabTop(0, [66, 70, 82]);
    slabTop(0.35, [19, 22, 30]);
    for (let i = 0; i < 4 + d.size * 0.4; i++) {
      const px0 = d.x + 1 + hash(did, i, 1) * (d.size - 2), pz0 = d.z + 1 + hash(did, i, 2) * (d.size - 2), a = 0.5 + hash(did, i, 3) * 1.1, b = 0.3 + hash(did, i, 4) * 0.5;
      px.quad(Array.from({ length: 8 }, (_, k): Pt => P(px0 + Math.cos(k * Math.PI / 4) * a, pz0 + Math.sin(k * Math.PI / 4) * b)), [40, 52, 78], 0.55);
    }
    // Alleys run between the cells: dashes down their middles.
    const xs = [...new Set(d.buildings.flatMap((b) => [Math.round((b.x - b.w / 2 - GAP / 2) * 100), Math.round((b.x + b.w / 2 + GAP / 2) * 100)]))].map((v) => v / 100);
    const zs = [...new Set(d.buildings.flatMap((b) => [Math.round((b.z - b.w / 2 - GAP / 2) * 100), Math.round((b.z + b.w / 2 + GAP / 2) * 100)]))].map((v) => v / 100);
    for (const ax of xs) for (let z = d.z + 0.4; z < d.z + d.size - 1; z += 1.1) px.line(P(ax, z), P(ax, z + 0.55), Math.max(1, 0.1 * s), [176, 150, 80], 0.5);
    for (const az of zs) for (let x = d.x + 0.4; x < d.x + d.size - 1; x += 1.1) px.line(P(x, az), P(x + 0.55, az), Math.max(1, 0.1 * s), [176, 150, 80], 0.5);
    for (const b of d.buildings) {
      const r = b.w / 2 + 0.28;
      px.quad([P(b.x - r, b.z - r), P(b.x + r, b.z - r), P(b.x + r, b.z + r), P(b.x - r, b.z + r)], [46, 49, 58]);
    }

    const items: Item[] = [];
    // Traffic: long-exposure trails, and cars with their lamps on.
    const lanes: { fixed: number; alongX: boolean }[] = [...xs.map((fixed) => ({ fixed, alongX: false })), ...zs.map((fixed) => ({ fixed, alongX: true }))];
    lanes.forEach((ln, li) => {
      for (let c = 0; c < 2; c++) {
        if (hash(did, li, c + 20) > 0.55 + d.pulse.bustle * 0.3) continue;
        const dir = hash(did, li, c + 30) < 0.5 ? -1 : 1, off = dir * 0.3, t = 0.8 + hash(did, li, c + 40) * (d.size - 2.4);
        const pos = (along: number): [number, number] => ln.alongX ? [d.x + along, ln.fixed + off] : [ln.fixed + off, d.z + along];
        const [qx, qz] = pos(t), tail: RGB = dir * (ln.alongX ? 1 : 1) > 0 ? [255, 40, 50] : [255, 225, 190];
        px.line(P(...pos(Math.max(0.4, t - 3))), P(...pos(t)), Math.max(1.4, 0.12 * s), tail, 0.35, true);
        const col = CARS[Math.floor(hash(did, li, c + 50) * CARS.length)]!, fog = fogAt(qx + qz);
        items.push({ key: qx + qz, draw() {
          const rx = ln.alongX ? 0.62 : 0.3, rz = ln.alongX ? 0.3 : 0.62;
          box(qx, qz, rx, rz, 0, 0.5, { wall: col, fog, id: li * 9 + c });
          box(qx, qz, rx * (ln.alongX ? 0.55 : 0.8), rz * (ln.alongX ? 0.8 : 0.55), 0.5, 0.82, { wall: GLASS, fog, id: li * 9 + c + 1 });
          const fwd = ln.alongX ? [dir * 0.62, 0] : [0, dir * 0.62], hl = P(qx + fwd[0]!, qz + fwd[1]!, 0.22), tl = P(qx - fwd[0]!, qz - fwd[1]!, 0.22);
          px.glow(hl[0], hl[1], 6, 5, [255, 235, 190], 0.55);
          px.glow(tl[0], tl[1], 6, 4, [255, 30, 40], 0.5);
        } });
      }
    });
    // Lamps at the crossings, sodium orange, with pools on the wet street.
    for (const ax of xs) for (const az of zs) {
      if (hash(did, Math.round(ax * 10), Math.round(az * 10)) > 0.5) continue;
      const base = P(ax + 0.7, az + 0.7), tip = P(ax + 0.7, az + 0.7, 2.2);
      items.push({ key: ax + az, draw() {
        px.line(base, tip, 1.3, [84, 88, 98]);
        px.glow(tip[0], tip[1], 9, 9, [255, 180, 90], 0.7);
        px.glow(base[0], base[1] + 2, 20, 9, [255, 170, 80], 0.22);
        px.glow(base[0], base[1] + 12, 3, 16, [255, 180, 90], 0.22);
      } });
    }
    // Umbrellas on the sidewalks.
    for (let i = 0; i < 2 + Math.round(d.pulse.bustle * 7); i++) {
      const b = d.buildings[Math.floor(hash(did, i, 60) * d.buildings.length)]!, ux = b.x + b.w / 2 + 0.55, uz = b.z - b.w / 2 + hash(did, i, 61) * b.w;
      items.push({ key: ux + uz, draw() {
        const feet = P(ux, uz), head = P(ux, uz, 0.8), col = UMBRELLAS[Math.floor(hash(did, i, 62) * UMBRELLAS.length)]!;
        px.line(feet, head, Math.max(1, 0.1 * s), [12, 12, 16]);
        px.quad(Array.from({ length: 8 }, (_, k): Pt => [head[0] + Math.cos(k * Math.PI / 4) * 0.5 * s, head[1] - 0.05 * s + Math.sin(k * Math.PI / 4) * 0.25 * s]), col, 0.95);
        px.glow(head[0], head[1], 7, 5, col, 0.35);
      } });
    }

    for (const b of d.buildings) {
      const id = Math.floor(b.x * 100 + b.z * 17 + seed), agent = b.agent >= 0.5, fog = fogAt(b.x + b.z), r = b.w / 2, wall = agent ? GLASS : WALLS[Math.floor(hash(id, 1) * WALLS.length)]!;
      items.push({ key: b.x + b.z, draw() {
        // Tall towers step in once.
        const H = sq(b.h), tall = H > 8, step = tall ? H * 0.68 : H;
        const base = P(b.x, b.z);
        px.glow(base[0], base[1] + 3, r * s * 1.6, r * s * 0.7, mul(LIT[Math.floor(hash(id, 2) * 3)]!, 1), 0.08 + b.glow * 0.3);
        const faces = box(b.x, b.z, r, r, 0, step, { wall, fog, glass: agent, lit: b.glow, id, windows: true, shop: true })!;
        if (tall) box(b.x, b.z, r * 0.72, r * 0.72, step, H, { wall, fog, glass: agent, lit: b.glow, id: id + 1, windows: true });
        // A neon sign on the ground floor.
        if (hash(id, 3) < 0.6 && H > 1.5) {
          const f = hash(id, 4) < 0.5 ? 0 : 1, [p, q] = faces[f]!, col = NEON[Math.floor(hash(id, 5) * NEON.length)]!, sy = 1.2 * s;
          const at = (a: number, v: number): Pt => [p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a - v * s];
          px.quad([at(0.2, 2.1), at(0.8, 2.1), at(0.8, 1.2), at(0.2, 1.2)], col);
          for (let k = 0; k < 3; k++) { const u = 0.3 + k * 0.17 + hash(id, k, 6) * 0.05; px.quad([at(u, 2), at(u + 0.06, 2), at(u + 0.06, 1.3), at(u, 1.3)], [10, 8, 14], 0.45); }
          const mid = at(0.5, 1.65);
          px.glow(mid[0], mid[1], 12 + sy * 0.6, 9 + sy * 0.4, col, 0.55);
          px.glow(mid[0], base[1] + 10, 7, 20, col, 0.28);
        }
        // Rooftop clutter and an aerial with its red light.
        for (let k = 0; k < 1 + Math.floor(hash(id, 7) * 3); k++) {
          const ox = (hash(id, k, 8) - 0.5) * r * 0.9, oz = (hash(id, k, 9) - 0.5) * r * 0.9, ru = 0.2 + hash(id, k, 10) * 0.18;
          box(b.x + ox, b.z + oz, ru, ru, H, H + 0.35 + hash(id, k, 11) * 0.4, { wall: [74, 76, 82], fog, id: id + k });
        }
        if (H > 6 || hash(id, 12) > 0.8) {
          const a = P(b.x, b.z, H), tip = P(b.x, b.z, H + 2 + hash(id, 13) * 2.5);
          px.line(a, tip, 1.1, [120, 124, 140], 0.8 * (1 - fog));
          px.glow(tip[0], tip[1], 5, 5, [255, 40, 40], 1);
        }
        if (H > 7 && hash(id, 14) < 0.4) {
          const [p, q] = faces[0]!, col = NEON[Math.floor(hash(id, 15) * NEON.length)]!, top = H * s;
          const at = (a: number, v: number): Pt => [p[0] + (q[0] - p[0]) * a, p[1] + (q[1] - p[1]) * a - top - v * s];
          px.quad([at(0.05, 0.4), at(0.95, 0.4), at(0.95, 2), at(0.05, 1.6)], col, 0.6, true);
          for (let k = 0; k < 4; k++) px.line(at(0.05, 0.6 + k * 0.35), at(0.95, 0.6 + k * 0.35), 1, [0, 0, 0], 0.35);
          const mid = at(0.5, 1.2);
          px.glow(mid[0], mid[1], 26, 18, col, 0.5);
        }
        for (const [sx, sz] of [[-r, r], [r, r]] as [number, number][]) {
          const g = P(b.x + sx, b.z + sz), col = LIT[Math.floor(hash(id, sx > 0 ? 21 : 22) * 3)]!;
          px.glow(g[0], g[1] + 14, 4, 18, col, 0.12 + b.glow * 0.18);
        }
        if (agent) px.line(P(b.x + r, b.z + r, 0), P(b.x + r, b.z + r, H), 1.4, [70, 215, 255], 0.55, true);
      } });
    }
    for (let i = 0; i < 1 + Math.round(d.pulse.bustle * 2); i++) {
      const v = P(d.x + 1.5 + hash(did, i, 90) * (d.size - 3), d.z + 1.5 + hash(did, i, 91) * (d.size - 3));
      items.push({ key: d.x + d.z + d.size * (0.6 + hash(did, i, 92) * 0.6), draw() { px.glow(v[0], v[1] - 10, 12, 26, [150, 135, 175], 0.2); px.glow(v[0] + 3, v[1] - 28, 18, 24, [130, 120, 160], 0.1); } });
    }
    for (const it of items.sort((a, c) => a.key - c.key)) it.draw();
    const mid = P(cx, cz, 3);
    px.glow(mid[0], mid[1], d.size * s * 0.75, 38, [96, 64, 128], 0.14);
  }

  // Rain in front of everything.
  for (let i = 0; i < 480; i++) px.rain(hash(seed, i, 71) * (W + 80), hash(seed, i, 72) * H, 14 + hash(seed, i, 73) * 26, [185, 205, 235], 0.1 + hash(seed, i, 74) * 0.2);
  finish(px, out, W, H, seed);
}

/** Tilt-shift, bloom, vignette and grain, then 8-bit. */
function finish(px: Pix, out: Uint8Array, W: number, H: number, seed: number) {
  let d = px.d;
  // Tilt-shift: blur toward the top and bottom edges, so it reads as a model on a table.
  const shifted = new Float32Array(d.length), mid = H * 0.52;
  const rows = new Float32Array(d.length);
  for (let y = 0; y < H; y++) {
    const r = Math.min(4, Math.ceil(Math.max(0, Math.abs(y - mid) - 140) / 40));
    for (let k = 0; k < 3; k++) {
      let sum = 0;
      if (r === 0) { for (let x = 0; x < W; x++) rows[(y * W + x) * 3 + k] = d[(y * W + x) * 3 + k]!; continue; }
      for (let x = -r; x <= r; x++) sum += d[(y * W + clamp(x, 0, W - 1)) * 3 + k]!;
      for (let x = 0; x < W; x++) {
        rows[(y * W + x) * 3 + k] = sum / (2 * r + 1);
        sum += d[(y * W + Math.min(W - 1, x + r + 1)) * 3 + k]! - d[(y * W + Math.max(0, x - r)) * 3 + k]!;
      }
    }
  }
  for (let y = 0; y < H; y++) {
    const r = Math.min(4, Math.ceil(Math.max(0, Math.abs(y - mid) - 140) / 40));
    for (let x = 0; x < W * 3; x++) {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) sum += rows[clamp(y + dy, 0, H - 1) * W * 3 + x]!;
      shifted[y * W * 3 + x] = sum / (2 * r + 1);
    }
  }
  d = shifted;
  // Bloom from a quarter-size copy: what's bright spills.
  const bw = W >> 2, bh = H >> 2, small = new Float32Array(bw * bh * 3);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) for (let k = 0; k < 3; k++) {
    let sum = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) sum += d[((y * 4 + dy) * W + x * 4 + dx) * 3 + k]!;
    small[(y * bw + x) * 3 + k] = Math.max(0, sum / 16 - 100);
  }
  const tight = blur(small, bw, bh, 3), wide = blur(blur(small, bw, bh, 8), bw, bh, 8);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bx = Math.min(bw - 1, x >> 2), by = Math.min(bh - 1, y >> 2), v = Math.hypot((x / W - 0.5) * 1.1, (y / H - 0.5) * 1.3), vig = 1 - 0.7 * v * v;
    const g = (hash(x, y, seed) - 0.5) * 9;
    for (let k = 0; k < 3; k++) {
      const o = (y * W + x) * 3 + k, b = (by * bw + bx) * 3 + k;
      out[o] = clamp((d[o]! + tight[b]! * 0.55 + wide[b]! * 0.8) * vig + g, 0, 255);
    }
  }
}
