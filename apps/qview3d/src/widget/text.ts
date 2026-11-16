// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// A line of text, drawn to a PNG on a clear background: from there it is a picture like any photo (texture, original,
// print file), so the print shop gets exactly the letters the shopper saw. Drawn big, so it stays sharp at print size.
import type { TextLine } from "../api.ts";

/** Each face as a font stack every phone and desktop has a member of. */
export const FACES: Record<TextLine["font"], { label: string; css: string; weight: number }> = {
  sans: { label: "Sans", css: `"Helvetica Neue", Arial, system-ui, sans-serif`, weight: 700 },
  serif: { label: "Serif", css: `Georgia, "Times New Roman", serif`, weight: 700 },
  mono: { label: "Mono", css: `ui-monospace, Menlo, Consolas, monospace`, weight: 700 },
  script: { label: "Script", css: `"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive`, weight: 400 },
  block: { label: "Block", css: `Impact, "Arial Black", "Helvetica Neue", sans-serif`, weight: 900 },
};

const SIZE = 200;

/** The line drawn as a PNG, its box fitted to the letters with a little room round them. */
export async function drawText(line: TextLine): Promise<Blob> {
  const face = FACES[line.font];
  const font = `${face.weight} ${SIZE}px ${face.css}`;
  const measure = new OffscreenCanvas(1, 1).getContext("2d")!;
  measure.font = font;
  const m = measure.measureText(line.value);
  const pad = SIZE * 0.12;
  const up = Math.max(m.actualBoundingBoxAscent, SIZE * 0.7), down = Math.max(m.actualBoundingBoxDescent, SIZE * 0.2);
  const w = Math.ceil(Math.max(m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + pad * 2), h = Math.ceil(up + down + pad * 2);
  const canvas = new OffscreenCanvas(Math.min(4096, w), h);
  const g = canvas.getContext("2d")!;
  g.font = font;
  g.fillStyle = line.color;
  g.textBaseline = "alphabetic";
  g.fillText(line.value, pad + m.actualBoundingBoxLeft, pad + up, canvas.width - pad * 2);
  return canvas.convertToBlob({ type: "image/png" });
}
