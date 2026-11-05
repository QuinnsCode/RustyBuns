// The tome's paper, rendered (#3558 round 7): one tileable sheet of vellum, `public/paper/vellum.png`, that every page's
// parchment is laid on (the bottom layer of --parchment in src/tome.css; the vignette, foxing, wear and the torn edge sit
// over it, and the page turn and the ink soak play over that). Procedural and re-runnable, no Blender and no canvas:
// periodic value noise gives the mottling (big, warm blotches), fibres (fine noise stretched along the grain) and a
// faint laid-line pattern, and a minimal PNG writer puts it on disk with Bun's deflate. Seeded, so the same sheet comes
// out every run, and small (the loose colour steps compress well).
//
//   bun scripts/paper.ts            writes public/paper/vellum.png and prints its size
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
export function png(rgb: Uint8Array, size: number): Uint8Array {
  const raw = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 3 + 1)] = 0; raw.set(rgb.subarray(y * size * 3, (y + 1) * size * 3), y * (size * 3 + 1) + 1); }
  const z = cat(new Uint8Array([0x78, 0xda]), new Uint8Array(Bun.deflateSync(raw, { level: 9 })), be32(adler(raw)));
  const ihdr = cat(be32(size), be32(size), new Uint8Array([8, 2, 0, 0, 0]));
  return cat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0)));
}

if (import.meta.main) {
  const out = new URL("../public/paper/vellum.png", import.meta.url);
  const bytes = png(vellum(SIZE, SEED), SIZE);
  await Bun.write(out, bytes);
  console.log(`${out.pathname}: ${SIZE} x ${SIZE}, ${(bytes.length / 1024).toFixed(0)} KB, seed ${SEED}`);
}
