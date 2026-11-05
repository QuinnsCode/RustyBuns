// The tome's paper, rendered (#3558 round 7): one tileable sheet of vellum, `public/paper/vellum.png`, that every page's
// parchment is laid on (the bottom layer of --parchment in src/tome.css; the vignette, foxing, wear and the torn edge sit
// over it, and the page turn and the ink soak play over that). Procedural and re-runnable, no Blender and no canvas:
// periodic value noise gives the mottling (big, warm blotches), fibres (fine noise stretched along the grain) and a
// faint laid-line pattern, and a minimal PNG writer puts it on disk with Bun's deflate. Seeded, so the same sheet comes
// out every run, and small (the loose colour steps compress well).
//
//   bun scripts/paper.ts            writes public/paper/{vellum,deckle,gutter,bark}.png and prints their sizes
//   bun scripts/paper.ts --size 768 --seed 9
import { mulberry32 } from "@rustybuns/util";

const arg = (name: string, d: number) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : d; };
const SIZE = arg("--size", 640), SEED = arg("--seed", 7);

/** Periodic value noise: a lattice of `n` random values a side that wraps, read with smooth interpolation, so the tile
 * joins itself on every edge. */
function lattice(n: number, rand: () => number) {
  const v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = rand();
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = ((x % 1) + 1) % 1 * n, fy = ((y % 1) + 1) % 1 * n, x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const tx = fade(fx - x0), ty = fade(fy - y0);
    const a = v[y0 * n + x0]! * (1 - tx) + v[y0 * n + x1]! * tx, b = v[y1 * n + x0]! * (1 - tx) + v[y1 * n + x1]! * tx;
    return a * (1 - ty) + b * ty;
  };
}

/** The sheet as RGB bytes, `size` a side. */
export function vellum(size: number, seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const mottle = [lattice(3, rand), lattice(6, rand), lattice(12, rand)];
  const fibre = [lattice(160, rand), lattice(320, rand)];
  const grain = lattice(48, rand), laid = lattice(4, rand);
  const px = new Uint8Array(size * size * 3);
  const base = [0xe8, 0xd9, 0xb5], dark = [0xc9, 0xae, 0x80], warm = [0xd9, 0xc0, 0x8e];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // mottling: three octaves of big blotches, pushed to the warm and the dark ends
    const m = mottle[0]!(u, v) * 0.55 + mottle[1]!(u, v) * 0.3 + mottle[2]!(u, v) * 0.15;
    // fibres: fine noise stretched eight to one along the grain, and a second set across it, fainter
    const f = (fibre[0]!(u, v * 8) - 0.5) * 0.11 + (fibre[1]!(u * 8, v) - 0.5) * 0.04;
    // laid lines: the faint ribs of the mould, wobbling a little
    const l = Math.sin((v * size) / 5.2 + laid(u, v) * 2) * 0.008;
    const g = (grain(u, v) - 0.5) * 0.05;
    const k = Math.max(0, Math.min(1, m)), w = Math.max(0, m - 0.55) * 1.6;
    const i = (y * size + x) * 3;
    for (let c = 0; c < 3; c++) {
      let val = base[c]! * (1 - k * 0.5) + dark[c]! * (k * 0.5);
      val = val * (1 - w * 0.4) + warm[c]! * (w * 0.4);
      val *= 1 + f + l + g;
      px[i + c] = Math.max(0, Math.min(255, Math.round(val / 4) * 4)); // loose colour steps: smaller on disk, invisible on paper
    }
  }
  return px;
}

// --- the compendium bound (#3587 round 9): a deckled edge, the gutter's shadow and the cedar-bark boards ----------
// Three small sheets the journal's spread is built from (src/tome.css): the deckle is a mask the page is cut with,
// nine-sliced so its four edges repeat round any size of page; the gutter is the crease's light and shadow baked
// from a model of two leaves curving into the spine, with the binding thread showing in it; the bark is the boards
// the book is bound in ("a book bound in cedar bark", the Bog Witch's sheet), seen round the edge of the leaves.

/** The deckle sizes: a `size` square nine-sliced at `border`, so each edge's middle is `size - 2 * border` long and
 * repeats (`round`) along the page; the corners are their own. */
export const DECKLE = { size: 384, border: 48 } as const;
export const GUTTER = { w: 320, h: 384 } as const;
export const BARK = 192;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** One edge of hand-made paper, `len` along by `depth` deep (depth 0 is the outside), as coverage 0..1, periodic
 * along its length: the ragged line where the fibres thin out, the thinner (more see-through) paper just inside it,
 * and loose fibres straying past it. */
function edge(len: number, depth: number, rand: () => number) {
  const waves = [lattice(3, rand), lattice(7, rand), lattice(17, rand), lattice(43, rand)], amp = [0.45, 0.28, 0.17, 0.1];
  const line = (s: number) => 9 + 15 * waves.reduce((n, w, i) => n + w(s, 0.37) * amp[i]!, 0); // 9 to 24 px in
  const a = new Float32Array(len * depth);
  for (let i = 0; i < len; i++) {
    const p = line(i / len);
    for (let d = 0; d < depth; d++) a[i * depth + d] = clamp01((d - p) / 1.3 + 0.5) * (0.62 + 0.38 * clamp01((d - p) / 10));
  }
  // loose fibres: short hairs that start in the paper and stray outward, leaning along the edge
  const hairs = Math.round(len / 2.6);
  for (let h = 0; h < hairs; h++) {
    const s0 = rand() * len, d0 = line(s0 / len) + 1.5, n = 3 + rand() * 8, th = (rand() - 0.5) * 1.8, op = 0.3 + rand() * 0.4;
    for (let t = 0; t <= n; t += 0.25) {
      const s = s0 + Math.sin(th) * t, d = d0 - Math.cos(th) * t;
      for (let di = Math.floor(d - 1); di <= Math.ceil(d + 1); di++) for (let si = Math.floor(s - 1); si <= Math.ceil(s + 1); si++) {
        if (di < 0 || di >= depth) continue;
        const k = op * Math.exp(-((di - d) ** 2 + (si - s) ** 2) / 0.35), at = ((si % len) + len) % len * depth + di;
        if (k > a[at]!) a[at] = k;
      }
    }
  }
  return (along: number, d: number) => (d >= depth ? 1 : a[(((Math.round(along) % len) + len) % len) * depth + d]!);
}

/** The deckle mask: grey + alpha, `size` a side, the page wherever alpha is up. Each edge is measured from where its
 * repeating middle starts, so a corner joins its two edges and every repeat joins the next. */
export function deckle(size: number, border: number, seed: number): Uint8Array {
  const rand = mulberry32(seed * 31 + 5), len = size - 2 * border;
  const [l, r, t, b] = [edge(len, border, rand), edge(len, border, rand), edge(len, border, rand), edge(len, border, rand)];
  const px = new Uint8Array(size * size * 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = l(y - border, x) * r(y - border, size - 1 - x) * t(x - border, y) * b(x - border, size - 1 - y);
    px[(y * size + x) * 2 + 1] = Math.round(k * 255); // grey 0; only the alpha masks
  }
  return px;
}

/** The gutter: light and shadow over the paper where the two leaves curve into the spine (RGBA, `w` across, `h` down,
 * repeating down the page). Each leaf rises out of the spine and flattens (h = A(1 - e^(-|x|/k)), k breathing a
 * little down the page); a lamp up and to the left lights the right leaf's slope and leaves the left leaf's in shade;
 * the crease itself is occluded. Darker than the flat page is drawn in umber, lighter in cream, both as alpha over
 * the vellum. Down the crease the binding thread shows between its sewing holes. */
export function gutter(w: number, h: number, seed: number): Uint8Array {
  const rand = mulberry32(seed * 17 + 3), breathe = lattice(4, rand), fray = lattice(24, rand);
  const lamp = [-0.5, -0.18, 1], ln = Math.hypot(...lamp), L = lamp.map((c) => c / ln);
  const px = new Uint8Array(w * h * 4), half = w / 2;
  for (let y = 0; y < h; y++) {
    const k = 34 * (0.85 + 0.3 * breathe(0.5, y / h)), A = 1.25 * k;
    for (let xi = 0; xi < w; xi++) {
      const x = xi + 0.5 - half, ax = Math.abs(x), slope = (A / k) * Math.exp(-ax / k) * Math.sign(x);
      const nl = Math.hypot(slope, 1), lit = ((-slope / nl) * L[0]! + (1 / nl) * L[2]!) / L[2]!;
      const occ = 1 - 0.62 * Math.exp(-ax / 11) - 0.18 * Math.exp(-ax / 55);
      const win = clamp01((half - ax) / 46);
      const dev = (lit * occ - 1) * win * (1 + (fray(xi / w, y / h) - 0.5) * 0.25);
      const i = (y * w + xi) * 4;
      const c = dev < 0 ? [40, 22, 8] : [255, 246, 222];
      px[i] = c[0]!; px[i + 1] = c[1]!; px[i + 2] = c[2]!;
      px[i + 3] = Math.round(clamp01(dev < 0 ? -dev * 0.95 : dev * 0.55) * 255);
    }
  }
  // the binding thread: two runs of linen down each repeat, each between a pair of dark sewing holes
  const runs = [[0.05, 0.45], [0.55, 0.95]].map(([a, b]) => [a! * h, b! * h]);
  const put = (x: number, y: number, c: number[], a: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h || a <= 0) return;
    const i = (y * w + x) * 4, o = px[i + 3]! / 255, na = a + o * (1 - a);
    for (let ch = 0; ch < 3; ch++) px[i + ch] = Math.round((c[ch]! * a + px[i + ch]! * o * (1 - a)) / na);
    px[i + 3] = Math.round(na * 255);
  };
  for (const [a, b] of runs) {
    for (let y = Math.ceil(a!); y < b!; y++) {
      const cx = half - 0.5 + Math.sin(y / 9) * 0.35;
      for (let xi = Math.floor(cx - 2); xi <= Math.ceil(cx + 3); xi++) {
        const d = xi - cx;
        put(xi, y, [178, 156, 116], clamp01(1.1 - Math.abs(d) / 0.9) * 0.78); // the thread, grimed with age
        if (d > 1 && d < 3.2) put(xi, y, [30, 16, 6], 0.3 * (1 - (d - 1) / 2.2)); // its shadow, cast to the right
      }
    }
    for (const yc of [a!, b!]) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const r = Math.hypot(dx, dy);
      put(Math.round(half - 0.5) + dx, Math.round(yc) + dy, [18, 9, 3], clamp01(2.4 - r) * 0.85);
    }
  }
  return px;
}

/** The boards: cedar bark (RGB, `size` a side, tileable), long fibrous ridges running down with dark furrows between,
 * reddish where it is fresh and silvered where the ridges have weathered. */
export function bark(size: number, seed: number): Uint8Array {
  const rand = mulberry32(seed * 13 + 1);
  const ridges = lattice(8, rand), fine = lattice(16, rand), patch = lattice(4, rand), knots = lattice(6, rand);
  const fresh = [124, 70, 42], furrow = [38, 20, 12], silver = [128, 114, 98];
  const px = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // ridges: noise four times finer across than down, folded to sharp crests; fine strands over them
    const r = 1 - Math.abs(2 * ridges(u * 4, v) - 1), f = 1 - Math.abs(2 * fine(u * 6, v * 2) - 1);
    const height = clamp01(r * 0.7 + f * 0.3 + (knots(u, v) - 0.5) * 0.2);
    const weather = clamp01((patch(u, v) - 0.35) * 2.2) * clamp01(height * 1.4 - 0.3);
    const i = (y * size + x) * 3;
    for (let c = 0; c < 3; c++) {
      const lit = furrow[c]! + (fresh[c]! - furrow[c]!) * height ** 1.4;
      px[i + c] = Math.max(0, Math.min(255, Math.round((lit * (1 - weather * 0.6) + silver[c]! * weather * 0.6 * height) / 4) * 4));
    }
  }
  return px;
}

// --- a minimal PNG writer: one IHDR, one zlib-wrapped IDAT of filter-0 rows, IEND ---------------------------------
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const adler = (b: Uint8Array) => { let a = 1, s = 0; for (const x of b) { a = (a + x) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; };
const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
function chunk(type: string, data: Uint8Array) {
  const t = new TextEncoder().encode(type), body = cat(t, data);
  return cat(be32(data.length), body, be32(crc32(body)));
}
/** `px` as a PNG, `w` by `h`, of 1 (grey), 2 (grey + alpha), 3 (RGB) or 4 (RGBA) channels a pixel. */
export function png(px: Uint8Array, w: number, h = w, channels = 3): Uint8Array {
  const row = w * channels, raw = new Uint8Array(h * (row + 1));
  for (let y = 0; y < h; y++) { raw[y * (row + 1)] = 0; raw.set(px.subarray(y * row, (y + 1) * row), y * (row + 1) + 1); }
  const z = cat(new Uint8Array([0x78, 0xda]), new Uint8Array(Bun.deflateSync(raw, { level: 9 })), be32(adler(raw)));
  const ihdr = cat(be32(w), be32(h), new Uint8Array([8, [0, 0, 4, 2, 6][channels]!, 0, 0, 0]));
  return cat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0)));
}

if (import.meta.main) {
  const sheets: [string, Uint8Array][] = [
    ["vellum.png", png(vellum(SIZE, SEED), SIZE)],
    ["deckle.png", png(deckle(DECKLE.size, DECKLE.border, SEED), DECKLE.size, DECKLE.size, 2)],
    ["gutter.png", png(gutter(GUTTER.w, GUTTER.h, SEED), GUTTER.w, GUTTER.h, 4)],
    ["bark.png", png(bark(BARK, SEED), BARK)],
  ];
  for (const [name, bytes] of sheets) {
    const out = new URL(`../public/paper/${name}`, import.meta.url);
    await Bun.write(out, bytes);
    console.log(`${out.pathname}: ${(bytes.length / 1024).toFixed(1)} KB, seed ${SEED}`);
  }
}
