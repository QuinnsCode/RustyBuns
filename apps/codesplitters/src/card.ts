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
  /** Fill a convex polygon, row by row. */
  poly(pts: [number, number][], c: RGB) {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.max(0, Math.ceil(Math.min(...ys))); y < Math.min(H, Math.max(...ys)); y++) {
      let lo = Infinity, hi = -Infinity;
      pts.forEach(([x0, y0], i) => {
        const [x1, y1] = pts[(i + 1) % pts.length]!;
        if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) { const x = x0 + ((y - y0) / (y1 - y0)) * (x1 - x0); lo = Math.min(lo, x); hi = Math.max(hi, x); }
      });
      if (lo <= hi) this.rect(Math.round(lo), y, Math.round(hi) - Math.round(lo) + 1, 1, c);
    }
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
  // When they don't all fit, the last row that does says how many more there are.
  const top = 104, fit = Math.floor((H - top - 96) / lh), width = String(Math.max(...card.lines.map((l) => l.n ?? 0), 1)).length;
  const rows = card.lines.length > fit ? fit - 1 : fit;
  card.lines.slice(0, rows).forEach((l, i) => {
    const y = top + i * lh;
    if (l.mark) c.rect(24, y + 4, 8, lh - 8, l.mark === "pass" ? GREEN : RED);
    const x = c.text((l.n === null ? "" : String(l.n)).padStart(width), 44, y, MUTED);
    c.text(l.text, x + cw, y, INK, W - 32);
  });
  if (card.lines.length > rows) c.text(`... ${card.lines.length - rows} more lines`, 44 + (width + 1) * cw, top + rows * lh, MUTED);
  c.rect(0, H - 88, W, 88, CANVAS);
  c.rect(0, H - 88, W, 1, [208, 215, 222]);
  const x = c.text(card.status, 40, H - 68, card.ok === null ? MUTED : card.ok ? GREEN : RED);
  c.text("codeSplitters", Math.max(x + cw, W - 40 - 13 * cw), H - 68, ORANGE);
  return png(c.px);
}

export interface PulseCard { title: string; hours: number[]; from: number; status: string; bot?: boolean }

/** A pulse (pulse.ts) as a card: a bar per hour over the week, a tick at each UTC midnight. */
export async function renderPulseCard(card: PulseCard): Promise<Uint8Array<ArrayBuffer>> {
  const c = new Canvas(glyphs("dejavu")), cw = GLYPH_W * S;
  c.rect(0, 0, W, H, PAPER);
  c.rect(0, 0, W, 8, ORANGE);
  const x0 = c.text(card.title, 40, 26, INK, W - 40);
  if (card.bot) c.text("(agent)", x0 + cw, 26, MUTED, W - 40);
  c.rect(0, 92, W, 1, [208, 215, 222]);
  const top = 130, base = H - 140, step = Math.floor((W - 120) / Math.max(1, card.hours.length)), left = Math.floor((W - step * card.hours.length) / 2);
  const max = Math.max(1, ...card.hours);
  c.rect(left, base, step * card.hours.length, 2, [208, 215, 222]);
  card.hours.forEach((n, i) => {
    const x = left + i * step, at = card.from + i * 3_600_000;
    if (at % 86_400_000 === 0) c.rect(x, top, 1, base - top, [234, 238, 242]);
    if (n) { const h = Math.max(4, Math.round((base - top) * n / max)); c.rect(x, base - h, Math.max(1, step - 1), h, ORANGE); }
  });
  c.text("a week ago", left, base + 12, MUTED);
  c.text("now", left + step * card.hours.length - 3 * cw, base + 12, MUTED);
  c.rect(0, H - 88, W, 88, CANVAS);
  c.rect(0, H - 88, W, 1, [208, 215, 222]);
  const x = c.text(card.status, 40, H - 68, INK);
  c.text("codeSplitters", Math.max(x + cw, W - 40 - 13 * cw), H - 68, ORANGE);
  return png(c.px);
}

// ---- code city postcard (city.ts) ----------------------------------------------

export interface CityCard {
  name: string; files: number; lines: number;
  districts: { x: number; z: number; size: number; buildings: { x: number; z: number; w: number; h: number; agent: number; glow: number }[] }[];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t)) as RGB;
/** People's lines are white stone, agents' are black glass; each as its roof, left and right faces. */
const STONE: RGB[] = [[252, 252, 250], [228, 231, 234], [204, 210, 215]], GLASS: RGB[] = [[74, 78, 84], [36, 39, 44], [18, 20, 23]];

/** A city's postcard: its districts in isometric, roofs lit orange where lines landed lately. */
export async function renderCity(city: CityCard): Promise<Uint8Array<ArrayBuffer>> {
  const c = new Canvas(glyphs("geist")), cw = GLYPH_W * S;
  c.rect(0, 0, W, H, PAPER);
  // Kamino haze: the sky pales toward the street.
  for (let y = 93; y < H - 88; y++) c.rect(0, y, W, 1, mix([226, 232, 236], PAPER, (y - 93) / (H - 181)));
  c.rect(0, 0, W, 8, ORANGE);
  c.text(`@${city.name}'s code city`, 40, 26, INK, W - 40);
  c.rect(0, 92, W, 1, [208, 215, 222]);
  const all = city.districts.flatMap((d) => d.buildings);
  // Isometric: x runs down-right, z down-left, height straight up.
  const iso = (x: number, z: number, y = 0): [number, number] => [(x - z) * 0.866, (x + z) * 0.5 - y];
  const corners = city.districts.flatMap((d) => [iso(d.x, d.z), iso(d.x + d.size, d.z), iso(d.x, d.z + d.size), iso(d.x + d.size, d.z + d.size)])
    .concat(all.map((b) => iso(b.x - b.w / 2, b.z - b.w / 2, b.h)));
  if (!all.length) c.text("no public repos to build with yet", 40, H / 2 - 20, MUTED);
  else {
    const [x0, x1] = [Math.min(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[0]))];
    const [y0, y1] = [Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[1]))];
    const top = 112, bottom = H - 104, s = Math.min((W - 120) / Math.max(1, x1 - x0), (bottom - top) / Math.max(1, y1 - y0));
    const at = (p: [number, number]): [number, number] => [W / 2 + (p[0] - (x0 + x1) / 2) * s, bottom - (y1 - p[1]) * s];
    for (const d of city.districts) c.poly([iso(d.x, d.z), iso(d.x + d.size, d.z), iso(d.x + d.size, d.z + d.size), iso(d.x, d.z + d.size)].map(at), [221, 226, 230]);
    // Back to front, so nearer towers stand in front of farther ones.
    for (const b of [...all].sort((a, b) => a.x + a.z - (b.x + b.z))) {
      const r = b.w / 2, [roof, left, right] = b.agent >= 0.5 ? GLASS : STONE;
      const p = (dx: number, dz: number, y: number) => at(iso(b.x + dx, b.z + dz, y));
      c.poly([p(-r, r, 0), p(r, r, 0), p(r, r, b.h), p(-r, r, b.h)], left!);
      c.poly([p(r, -r, 0), p(r, r, 0), p(r, r, b.h), p(r, -r, b.h)], right!);
      c.poly([p(-r, -r, b.h), p(r, -r, b.h), p(r, r, b.h), p(-r, r, b.h)], mix(roof!, ORANGE, b.glow));
    }
  }
  c.rect(0, H - 88, W, 88, CANVAS);
  c.rect(0, H - 88, W, 1, [208, 215, 222]);
  const n = (k: number, w: string) => `${k.toLocaleString("en-US")} ${w}${k === 1 ? "" : "s"}`;
  const x = c.text(`${n(city.districts.length, "district")}, ${n(city.files, "building")}, ${n(city.lines, "line")}`, 40, H - 68, MUTED);
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
