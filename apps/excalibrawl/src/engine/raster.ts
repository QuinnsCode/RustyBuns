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
    // Text reads as a dark bar where the words are: the model sees placement, not glyphs.
    const fs = (el.fontSize ?? 20) * s;
    const w = Math.max(1, el.text.length * fs * 0.6), h = fs;
    const x0 = (el.x - ox) * s, y0 = (el.y - oy) * s + h * 0.2;
    return { box: { x: x0, y: y0, w, h: h * 0.6 }, filled: true, dist: () => -1 };
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
