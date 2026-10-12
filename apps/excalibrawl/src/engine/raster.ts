// What a fighter sees: its own region of the canvas as a small PNG, drawn here rather than
// in a headless browser. Each shape is a distance function: inside it gets the fill, near
// its edge gets the outline. Crisp, not Excalidraw's hand-drawn wobble, which the model
// doesn't need. No dependencies, so it runs the same in the Worker and in bun test.

import { isLinear, type Bounds, type SkeletonEl } from "./types.ts";

type RGB = [number, number, number];

function rgb(hex: string | undefined): RGB | undefined {
  if (!hex) return undefined;
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : undefined;
}

/** Distance from (x, y) to the segment a-b. */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** Even-odd test against a closed polygon. */
function inPolygon(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A 5×7 bitmap font, so Clef can read a title: seven rows a glyph, two hex digits a row, the
// high bit of five on the left. Lower case draws as upper case; anything else is a hollow box.
const FONT: Record<string, string> = {
  " ": "00000000000000",
  A: "0E11111F111111", B: "1E11111E11111E", C: "0E11101010110E", D: "1C12111111121C",
  E: "1F10101E10101F", F: "1F10101E101010", G: "0E11101711110F", H: "1111111F111111",
  I: "0E04040404040E", J: "0702020202120C", K: "11121418141211", L: "1010101010101F",
  M: "111B1515111111", N: "11111915131111", O: "0E11111111110E", P: "1E11111E101010",
  Q: "0E11111115120D", R: "1E11111E141211", S: "0F10100E01011E", T: "1F040404040404",
  U: "1111111111110E", V: "11111111110A04", W: "1111111515150A", X: "11110A040A1111",
  Y: "1111110A040404", Z: "1F01020408101F",
  0: "0E11131519110E", 1: "040C040404040E", 2: "0E11010204081F", 3: "1F02040201110E",
  4: "02060A121F0202", 5: "1F101E0101110E", 6: "0608101E11110E", 7: "1F010204080808",
  8: "0E11110E11110E", 9: "0E11110F01020C",
  ".": "00000000000C0C", ",": "000000000C0408", "!": "04040404040004", "?": "0E110102040004",
  "'": "0C040800000000", '"': "0A0A0A00000000", "-": "0000001F000000", ":": "000C0C000C0C00",
  "/": "00010204081000", "+": "0004041F040400", "=": "00001F001F0000", "&": "0C12140815120D",
  "(": "02040808080402", ")": "08040202020408", "#": "0A0A1F0A1F0A0A",
};
const BOX = [0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f];
const GLYPHS = new Map(Object.entries(FONT).map(([c, hex]) => [c, Array.from({ length: 7 }, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16))]));
const glyphOf = (c: string): number[] => GLYPHS.get(c.toUpperCase()) ?? BOX;

interface Shape {
  /** Pixel-space box the shape can touch, outline included. */
  box: Bounds;
  /** Signed-ish distance: negative inside (when it has an inside), the edge at 0. */
  dist: (x: number, y: number) => number;
  filled: boolean;
}

function shapeOf(el: SkeletonEl, s: number, ox: number, oy: number, sw: number): Shape {
  const pad = sw + 2;
  if (isLinear(el)) {
    const pts = el.points.map(([px, py]) => [(el.x + px - ox) * s, (el.y + py - oy) * s] as [number, number]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const first = pts[0]!, last = pts[pts.length - 1]!;
    // A line that comes back to where it started, with a fill, is a polygon (the cat's ears).
    const closed = pts.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 4 * s + 1;
    const filled = !!el.backgroundColor && (closed || pts.length > 2);
    return {
      box: { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad },
      filled,
      dist: (x, y) => {
        let d = Infinity;
        for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, y, pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]));
        return filled && inPolygon(x, y, pts) ? -d : d;
      },
    };
  }
  if (el.type === "text") {
    // Each character is a 5×7 glyph in a 6-unit cell, a unit being a tenth of the font size, so
    // the words fill the same 0.6 × fontSize a character that bboxOf gives them.
    const u = (el.fontSize ?? 20) * s * 0.1;
    const x0 = (el.x - ox) * s, y0 = (el.y - oy) * s + 1.5 * u;
    const glyphs = [...el.text].map(glyphOf);
    // Below 2 px a unit, a pixel takes ink if any part of it does, so thin strokes don't vanish.
    const r = u < 2 ? 0.49 : 0;
    const ink = (x: number, y: number) => {
      const gx = Math.floor((x - x0) / u), gy = Math.floor((y - y0) / u);
      const col = gx % 6;
      return gy >= 0 && gy < 7 && gx >= 0 && col < 5 && ((glyphs[Math.floor(gx / 6)]?.[gy] ?? 0) >> (4 - col)) & 1;
    };
    return {
      box: { x: x0 - 1, y: y0 - 1, w: glyphs.length * 6 * u + 2, h: 7 * u + 2 },
      filled: true,
      dist: (x, y) => (ink(x, y) || (r && (ink(x - r, y - r) || ink(x + r, y - r) || ink(x - r, y + r) || ink(x + r, y + r))) ? -1 : 1),
    };
  }
  const x0 = (el.x - ox) * s, y0 = (el.y - oy) * s, w = el.width * s, h = el.height * s;
  const cx = x0 + w / 2, cy = y0 + h / 2, rx = Math.max(w / 2, 0.5), ry = Math.max(h / 2, 0.5);
  const box = { x: x0 - pad, y: y0 - pad, w: w + 2 * pad, h: h + 2 * pad };
  if (el.type === "ellipse") {
    const m = Math.min(rx, ry);
    return { box, filled: true, dist: (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * m };
  }
  if (el.type === "diamond") {
    const m = Math.min(rx, ry) / Math.SQRT2;
    return { box, filled: true, dist: (x, y) => (Math.abs(x - cx) / rx + Math.abs(y - cy) / ry - 1) * m };
  }
  return {
    box,
    filled: true,
    dist: (x, y) => {
      const dx = Math.abs(x - cx) - rx, dy = Math.abs(y - cy) - ry;
      return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy);
    },
  };
}

/** Paint `elements` that fall in `region` onto a `width` × `height` RGB buffer, back to front. */
export function rasterize(elements: SkeletonEl[], region: Bounds, width: number, height: number): Uint8Array {
  const px = new Uint8Array(width * height * 3).fill(255);
  const s = width / region.w;
  for (const el of elements) {
    const sw = Math.max(1, (el.strokeWidth ?? 2) * s);
    const shape = shapeOf(el, s, region.x, region.y, sw);
    const fill = el.type === "text" ? rgb(el.strokeColor) ?? [30, 30, 30] : shape.filled ? rgb(el.backgroundColor) : undefined;
    // Hachure and cross-hatch read as a lighter wash of the colour at this size.
    const wash = fill && el.fillStyle && el.fillStyle !== "solid" ? (fill.map((c) => Math.round((c + 255) / 2)) as RGB) : fill;
    const stroke = el.type === "text" ? undefined : rgb(el.strokeColor) ?? [30, 30, 30];
    const x0 = Math.max(0, Math.floor(shape.box.x)), x1 = Math.min(width, Math.ceil(shape.box.x + shape.box.w));
    const y0 = Math.max(0, Math.floor(shape.box.y)), y1 = Math.min(height, Math.ceil(shape.box.y + shape.box.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d = shape.dist(x + 0.5, y + 0.5);
        const c = stroke && Math.abs(d) <= sw / 2 ? stroke : d < 0 ? wash : undefined;
        if (!c) continue;
        const i = (y * width + x) * 3;
        px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
      }
    }
  }
  return px;
}

// --- PNG ---------------------------------------------------------------------

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An RGB buffer as a PNG file. */
export async function encodePng(rgbPx: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) raw.set(rgbPx.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}

/** The longest side of what Clef sees, in pixels: 384 is a 12×12 grid of its 32 px patches, ~150 tokens. */
export const VIEW_PX = 384;

/** A fighter's region as a PNG data URL, sized for Clef. */
export async function snapshot(elements: SkeletonEl[], region: Bounds, longSide = VIEW_PX): Promise<string> {
  const s = longSide / Math.max(region.w, region.h);
  const w = Math.max(32, Math.round(region.w * s)), h = Math.max(32, Math.round(region.h * s));
  const png = await encodePng(rasterize(elements, { ...region, w: w / s, h: h / s }, w, h), w, h);
  let bin = "";
  for (let i = 0; i < png.length; i += 0x8000) bin += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}
