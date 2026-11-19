// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// A shopper's photo, made into a texture: decoded by the browser's own codecs (createImageBitmap, off the main
// thread already), cut down to 1024 px on its long side on an OffscreenCanvas, encoded as WebP, and both files
// hashed for their R2 names. No WASM: the native decoders are faster than any we could ship, and cost 0 bytes.
// This runs in a Web Worker (image-worker.ts) when the page allows one, and right here when it doesn't.
//
// A photo over PRINT_COPY_PX (a 24 MP phone photo) also gets a print copy, cut down to that: a Worker can't decode
// the full one in its 128 MB (print-render.ts), and no print zone needs more. The server prints from the copy; the
// original is kept as uploaded.
import { PRINT_COPY_PX } from "../api.ts";

export const TEXTURE_MAX = 1024;

type File = { blob: Blob; sha256: string };
export type Prepared = {
  /** For drawing now: the texture-sized picture. */
  bitmap: ImageBitmap;
  aspect: number;
  texture: File;
  original: File;
  /** The print copy, for an original over PRINT_COPY_PX. */
  print?: File;
};

const hexOf = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export const sha256Of = async (blob: Blob) => hexOf(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));

/** `full` drawn at `k` of its size. */
function scaled(full: ImageBitmap, k: number) {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(full.width * k)), Math.max(1, Math.round(full.height * k)));
  const g = canvas.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(full, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The print copy: a JPEG photo stays a JPEG (at a quality no print shows), anything else a PNG, so a clear part stays clear. */
async function printCopy(full: ImageBitmap, type: string): Promise<File | undefined> {
  const px = full.width * full.height;
  if (px <= PRINT_COPY_PX) return undefined;
  const canvas = scaled(full, Math.sqrt(PRINT_COPY_PX / px) * 0.999);
  const blob = await canvas.convertToBlob(type === "image/jpeg" ? { type, quality: 0.95 } : { type: "image/png" });
  return { blob, sha256: await sha256Of(blob) };
}

export async function prepare(file: Blob): Promise<Prepared> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("A PNG, JPEG or WebP picture, please");
  const full = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = scaled(full, Math.min(1, TEXTURE_MAX / Math.max(full.width, full.height)));
  const print = await printCopy(full, file.type).finally(() => full.close());
  let blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
  if (blob.type !== "image/webp") blob = await canvas.convertToBlob({ type: "image/png" }); // Safari before 17 has no WebP encoder
  const [ts, os] = await Promise.all([sha256Of(blob), sha256Of(file)]);
  return { bitmap: canvas.transferToImageBitmap(), aspect: canvas.width / canvas.height, texture: { blob, sha256: ts }, original: { blob: file, sha256: os }, ...(print ? { print } : {}) };
}
