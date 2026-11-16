// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// A line of text as a picture: drawn on a canvas at print size, on a clear background, then sent down the same path
// as a photo (image.ts makes its texture, the PNG is its original). The print file needs nothing else, and the widget
// keeps the words, face and colour on the layer so the shopper can change them.
import type { Font, Words } from "../api.ts";

/** Each face as a stack every browser has, so no font file is fetched. */
export const FACES: Record<Font, { label: string; css: string }> = {
  sans: { label: "Sans", css: `600 {px}px "Helvetica Neue", Helvetica, Arial, sans-serif` },
  serif: { label: "Serif", css: `600 {px}px Georgia, "Times New Roman", serif` },
  mono: { label: "Mono", css: `700 {px}px ui-monospace, Menlo, Consolas, "Courier New", monospace` },
  bold: { label: "Block", css: `900 {px}px Impact, "Arial Black", "Helvetica Neue", sans-serif` },
  script: { label: "Script", css: `italic 500 {px}px "Brush Script MT", "Segoe Script", "Apple Chancery", cursive` },
};

/** Tall enough for a crisp print: a 30 cm wide line at 300 dpi still gets about 3,500 px across. */
const SIZE = 320;

/** The words drawn as a PNG, cut close round the letters. */
export async function wordsPicture(w: Words): Promise<Blob> {
  const font = FACES[w.font].css.replace("{px}", String(SIZE));
  const probe = new OffscreenCanvas(1, 1).getContext("2d")!;
  probe.font = font;
  const m = probe.measureText(w.line);
  const pad = Math.round(SIZE * 0.08);
  const up = Math.ceil(m.actualBoundingBoxAscent || SIZE * 0.8), down = Math.ceil(m.actualBoundingBoxDescent || SIZE * 0.2);
  const left = Math.ceil(m.actualBoundingBoxLeft || 0), right = Math.ceil(m.actualBoundingBoxRight || m.width);
  const c = new OffscreenCanvas(Math.max(1, left + right + pad * 2), Math.max(1, up + down + pad * 2));
  const g = c.getContext("2d")!;
  g.font = font;
  g.fillStyle = w.color;
  g.textBaseline = "alphabetic";
  g.fillText(w.line, pad + left, pad + up);
  return c.convertToBlob({ type: "image/png" });
}
