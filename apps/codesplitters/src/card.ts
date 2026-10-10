// The social card for a cut: its code and its test result as a 1200x630 PNG,
// so a link unfurls on X with the lines in it. Drawn by hand (font.ts glyphs,
// a PNG encoder on CompressionStream), so a Worker needs no image library.

import * as dejavu from "./font.ts";
import * as geist from "./font-geist.ts";

type RGB = [number, number, number];
export interface CardLine { n: number | null; text: string; mark?: "pass" | "fail" }
export interface Card { title: string; lines: CardLine[]; status: string; ok: boolean | null; font?: CardFont }

/** DejaVu Sans Mono by default; Geist Mono is the app's own code font. Both share one cell size. */
export const CARD_FONTS = { dejavu, geist };
export type CardFont = keyof typeof CARD_FONTS;
export const cardFont = (name: string | null | undefined): CardFont => (name && name in CARD_FONTS ? name as CardFont : "dejavu");
const { GLYPH_W, GLYPH_H } = dejavu;

const W = 1200, H = 630, S = 2;   // glyphs are drawn at twice their size, to read at thumbnail size
const INK: RGB = [31, 35, 40], MUTED: RGB = [101, 109, 118], PAPER: RGB = [255, 255, 255], CANVAS: RGB = [246, 248, 250];
const ORANGE: RGB = [251, 133, 0], GREEN: RGB = [26, 127, 55], RED: RGB = [207, 34, 46];

const decoded: Partial<Record<CardFont, Uint8Array>> = {};
const glyphs = (font: CardFont) => decoded[font] ??= Uint8Array.from(atob(CARD_FONTS[font].GLYPHS), (ch) => ch.charCodeAt(0));

class Canvas {
  px = new Uint8Array(W * H * 3);
  constructor(private glyphs: Uint8Array) {}
  ink(c: number, x: number, y: number) {
    const i = (c - 32) * GLYPH_W * GLYPH_H + y * GLYPH_W + x;
    return ((this.glyphs[i >> 2]! >> (6 - 2 * (i & 3))) & 3) / 3;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB) {
    for (let j = Math.max(0, y); j < Math.min(H, y + h); j++)
      for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) this.px.set(c, (j * W + i) * 3);
  }
  /** Draw text from (x, y), clipped at `maxX`; returns where it stopped. */
  text(s: string, x: number, y: number, c: RGB, maxX = W) {
    for (const ch of s.replace(/\t/g, "  ")) {
      if (x + GLYPH_W * S > maxX) break;
      const code = ch.charCodeAt(0), g = code >= 32 && code < 127 ? code : 63;
      for (let gy = 0; gy < GLYPH_H; gy++) for (let gx = 0; gx < GLYPH_W; gx++) {
        const a = this.ink(g, gx, gy);
        if (!a) continue;
        for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
          const px = x + gx * S + dx, py = y + gy * S + dy;
          if (px >= W || py >= H) continue;
          const o = (py * W + px) * 3;
          for (let k = 0; k < 3; k++) this.px[o + k] = Math.round(this.px[o + k]! * (1 - a) + c[k]! * a);
        }
      }
      x += GLYPH_W * S;
    }
    return x;
  }
}

export async function renderCard(card: Card): Promise<Uint8Array<ArrayBuffer>> {
  const c = new Canvas(glyphs(card.font ?? "dejavu")), cw = GLYPH_W * S, lh = GLYPH_H * S + 2;
  c.rect(0, 0, W, H, PAPER);
  c.rect(0, 0, W, 8, ORANGE);
  c.text(card.title, 40, 26, INK, W - 40);
  c.rect(0, 92, W, 1, [208, 215, 222]);
  // The code, with a gutter mark per line: green passed, red failed.
  const top = 104, rows = Math.floor((H - top - 96) / lh), width = String(Math.max(...card.lines.map((l) => l.n ?? 0), 1)).length;
  card.lines.slice(0, rows).forEach((l, i) => {
    const y = top + i * lh;
    if (l.mark) c.rect(24, y + 4, 8, lh - 8, l.mark === "pass" ? GREEN : RED);
    const x = c.text((l.n === null ? "" : String(l.n)).padStart(width), 44, y, MUTED);
    c.text(l.text, x + cw, y, INK, W - 32);
  });
  if (card.lines.length > rows) c.text(`... ${card.lines.length - rows} more lines`, 44 + (width + 1) * cw, top + rows * lh - 6, MUTED);
  c.rect(0, H - 88, W, 88, CANVAS);
  c.rect(0, H - 88, W, 1, [208, 215, 222]);
  const x = c.text(card.status, 40, H - 68, card.ok === null ? MUTED : card.ok ? GREEN : RED);
  c.text("codeSplitters", Math.max(x + cw, W - 40 - 13 * cw), H - 68, ORANGE);
  return png(c.px);
}

// ---- PNG -----------------------------------------------------------------------

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function png(rgb: Uint8Array) {
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) raw.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);   // filter 0 per row
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, W); v.setUint32(4, H); ihdr.set([8, 2, 0, 0, 0], 8);   // 8-bit RGB
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
