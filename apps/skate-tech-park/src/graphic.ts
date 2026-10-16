// A deck graphic: an image you upload, cropped to fill the deck's underside and kept small enough to remember in the browser.
import { DECK } from "./models.ts";

export const GRAPHIC_PX = { w: 256, h: Math.round((256 * DECK.length) / DECK.width) };
const KEY = "skate-tech-park.graphic";

/** The part of a w×h image to draw so it covers a tw×th box without stretching: a centred crop. */
export function coverCrop(w: number, h: number, tw: number, th: number) {
  const k = Math.max(tw / w, th / h), sw = tw / k, sh = th / k;
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
}

/**
 * Checks an upload before it is used. Pass a stricter one to refuse images (see shop.ts): a graphic only you see needs
 * none, but one other riders can see should be checked before it is shown to them.
 */
export type Moderate = (image: Blob) => Promise<boolean>;
export const allowAll: Moderate = async () => true;

/** Draws an uploaded image onto a canvas the size of the deck, or null when it is not an image or is refused. */
export async function loadGraphic(file: Blob, moderate: Moderate = allowAll): Promise<HTMLCanvasElement | null> {
  if (!file.type.startsWith("image/") || !(await moderate(file))) return null;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { return null; }
  const c = document.createElement("canvas");
  c.width = GRAPHIC_PX.w;
  c.height = GRAPHIC_PX.h;
  const { sx, sy, sw, sh } = coverCrop(bmp.width, bmp.height, c.width, c.height);
  c.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export function saveGraphic(c: HTMLCanvasElement) {
  try { localStorage.setItem(KEY, c.toDataURL("image/jpeg", 0.85)); } catch { /* too big or a private window: it just isn't remembered */ }
}

/** The remembered graphic, if any. */
export function savedGraphic(): Promise<HTMLImageElement | null> {
  let url: string | null = null;
  try { url = localStorage.getItem(KEY); } catch { /* none */ }
  if (!url) return Promise.resolve(null);
  return new Promise((done) => { const i = new Image(); i.onload = () => done(i); i.onerror = () => done(null); i.src = url!; });
}
