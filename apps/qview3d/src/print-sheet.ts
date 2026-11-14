// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Drawing a print file: the shopper's original laid over one zone at print resolution, on a clear background, the
// same way the widget lays its texture over the zone (print.ts): centre at u across and v up, width `scale` of the
// zone's, turned by `rotation`, cut at the zone's edge. The admin page runs it (a Worker has no canvas to draw with).
import type { PrintCm, PrintSheet } from "./api.ts";

/** Pixels for `cm` at `dpi`. */
export const toPx = (cm: number, dpi: number) => Math.max(1, Math.round((cm / 2.54) * dpi));

/** The sheet's size in pixels, and where the picture goes on it (its centre, size and turn; canvas y runs down). */
export function sheetLayout(px: { w: number; h: number }, at: PrintSheet["at"], aspect: number) {
  const w = at.scale * px.w;
  return { x: at.u * px.w, y: (1 - at.v) * px.h, w, h: w / aspect, rotation: at.rotation };
}

/** The zone's size in pixels at `dpi`. */
export const sheetPx = (cm: PrintCm, dpi: number) => ({ w: toPx(cm.w, dpi), h: toPx(cm.h, dpi) });

/** Draw the sheet: clear, the picture placed and cut at the zone's edge. */
export function drawSheet(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, sheet: PrintSheet, image: CanvasImageSource, aspect: number) {
  const { x, y, w, h, rotation } = sheetLayout(sheet.px, sheet.at, aspect);
  ctx.clearRect(0, 0, sheet.px.w, sheet.px.h);
  ctx.save();
  ctx.imageSmoothingQuality = "high";
  ctx.translate(x, y);
  ctx.rotate(-rotation);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * The PNG with its resolution written in (a pHYs chunk after the header), so a print shop's software opens it at
 * its real size rather than 72 dpi. A canvas's PNG has none; anything that isn't a PNG comes back as it was.
 */
export function withDpi(png: Uint8Array, dpi: number): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || sig.some((b, i) => png[i] !== b)) return png;
  const chunk = new Uint8Array(21);
  const v = new DataView(chunk.buffer);
  v.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4); // "pHYs"
  const ppm = Math.round(dpi / 0.0254);
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  chunk[16] = 1; // metres
  v.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, 33)); // signature + IHDR
  out.set(chunk, 33);
  out.set(png.subarray(33), 33 + chunk.length);
  return out;
}
