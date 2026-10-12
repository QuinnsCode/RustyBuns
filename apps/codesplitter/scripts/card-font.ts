// Rasterizes a monospace TTF/OTF into the share card's glyph format (see
// font.ts): ASCII 32-126, an 11x22 cell, baseline at row 17, 2 bits a pixel.
// The font is scaled so its advance fills the cell, and each pixel's ink is
// its coverage over a 4x4 grid of samples.
//
//   bun add --no-save opentype.js@1.3.4
//   bun scripts/card-font.ts GeistMono-Regular.ttf src/font-geist.ts "Geist Mono, SIL OFL 1.1: ..."

import opentype from "opentype.js";

const W = 11, H = 22, BASE = 17, SS = 4;
const [src, out, note] = process.argv.slice(2);
if (!src || !out) throw new Error("usage: bun scripts/card-font.ts <font.ttf> <out.ts> [note]");

const font = opentype.parse((await Bun.file(src).arrayBuffer()) as ArrayBuffer);
const size = (W * font.unitsPerEm) / font.charToGlyph("M").advanceWidth!;

type Pt = [number, number];
/** The glyph's outline as closed polygons, curves flattened. */
function polygons(ch: string): Pt[][] {
  const polys: Pt[][] = [];
  let cur: Pt[] = [], at: Pt = [0, 0];
  const curve = (n: number, f: (t: number) => Pt) => { for (let i = 1; i <= n; i++) cur.push(f(i / n)); };
  for (const c of font.getPath(ch, 0, BASE, size).commands as any[]) {
    if (c.type === "M") { if (cur.length) polys.push(cur); cur = [[c.x, c.y]]; }
    else if (c.type === "L") cur.push([c.x, c.y]);
    else if (c.type === "Q") { const [x0, y0] = at; curve(8, (t) => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * c.x1 + t * t * c.x, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * c.y1 + t * t * c.y]); }
    else if (c.type === "C") { const [x0, y0] = at; curve(12, (t) => [(1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * c.x1 + 3 * (1 - t) * t * t * c.x2 + t ** 3 * c.x, (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * c.y1 + 3 * (1 - t) * t * t * c.y2 + t ** 3 * c.y]); }
    else if (c.type === "Z") { if (cur.length) polys.push(cur); cur = []; }
    if (c.type !== "Z") at = [c.x, c.y];
  }
  if (cur.length) polys.push(cur);
  return polys;
}

/** Nonzero winding: is (x, y) inside? */
function inside(polys: Pt[][], x: number, y: number) {
  let wind = 0;
  for (const p of polys) for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!, [x1, y1] = p[(i + 1) % p.length]!;
    if ((y0 <= y) === (y1 <= y)) continue;
    if (x0 + ((y - y0) / (y1 - y0)) * (x1 - x0) > x) wind += y1 > y0 ? 1 : -1;
  }
  return wind !== 0;
}

const bits = new Uint8Array(Math.ceil((95 * W * H) / 4));
for (let code = 32; code < 127; code++) {
  const polys = polygons(String.fromCharCode(code));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let hit = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (inside(polys, x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++;
    const level = Math.round((hit / (SS * SS)) * 3), i = (code - 32) * W * H + y * W + x;
    bits[i >> 2]! |= level << (6 - 2 * (i & 3));
  }
}

await Bun.write(out, `// ${note ?? src}
// Rasterized by scripts/card-font.ts: ASCII 32-126, ${W}x${H}, 2 bits a pixel.

export const GLYPH_W = ${W}, GLYPH_H = ${H};
export const GLYPHS = "${Buffer.from(bits).toString("base64")}";
`);
console.log(`wrote ${out} (${font.names.fullName?.en ?? src} at ${size.toFixed(2)}px)`);
