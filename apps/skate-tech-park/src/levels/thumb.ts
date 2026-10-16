// A card's picture of a level: the floor sampled into a small hillshaded, contoured height map, drawn like a
// digital terrain model. `terrainPixels` is pure (RGBA bytes); `terrainCanvas` paints it.
import type { Level } from "../level.ts";
import type { ParkLevel } from "./park.ts";

/** Half the width of the square the level covers, in metres. */
export const extent = (l: Level | ParkLevel) => ("ground" in l ? l.ground.R : Math.max(...[l.bounds.minX, l.bounds.maxX, l.bounds.minZ, l.bounds.maxZ].map(Math.abs)));

const LOW = [64, 86, 58], HIGH = [232, 224, 206], CONTOUR = 12; // metres between contour lines

/** `size` x `size` RGBA bytes, north (-z) up: green lowlands to pale highs, lit from the north-west, with contour lines. */
export function terrainPixels(l: Level | ParkLevel, size: number): Uint8ClampedArray<ArrayBuffer> {
  const R = extent(l), step = (2 * R) / size, h = new Float32Array(size * size);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const v = l.height(-R + (i + 0.5) * step, -R + (j + 0.5) * step);
    h[j * size + i] = v;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const at = (i: number, j: number) => h[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))]!;
  const out = new Uint8ClampedArray(new ArrayBuffer(size * size * 4)), span = Math.max(hi - lo, 1e-6);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const v = at(i, j), t = (v - lo) / span;
    const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * step), dz = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
    const shade = Math.min(1.35, Math.max(0.55, 1 + (dx + dz) * 0.9)); // slopes facing the north-west catch the light
    const line = hi - lo > CONTOUR && Math.abs(((v - lo) % CONTOUR) - CONTOUR / 2) > CONTOUR / 2 - 0.35 * step * Math.hypot(dx, dz) - 0.25 ? 0.72 : 1;
    const k = (j * size + i) * 4;
    for (let c = 0; c < 3; c++) out[k + c] = (LOW[c]! + (HIGH[c]! - LOW[c]!) * t) * shade * line;
    out[k + 3] = 255;
  }
  return out;
}

/** The map as a canvas, with a faint survey grid over it. */
export function terrainCanvas(l: Level | ParkLevel, size = 96): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;
  ctx.putImageData(new ImageData(terrainPixels(l, size), size, size), 0, 0);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  for (let g = size / 8; g < size; g += size / 8) { ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, size); ctx.moveTo(0, g); ctx.lineTo(size, g); ctx.stroke(); }
  return cv;
}
