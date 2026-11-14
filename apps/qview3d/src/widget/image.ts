// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// A shopper's photo, made into a texture: decoded by the browser's own codecs (createImageBitmap, off the main
// thread already), cut down to 1024 px on its long side on an OffscreenCanvas, encoded as WebP, and both files
// hashed for their R2 names. No WASM: the native decoders are faster than any we could ship, and cost 0 bytes.
// This runs in a Web Worker (image-worker.ts) when the page allows one, and right here when it doesn't.

export const TEXTURE_MAX = 1024;

export type Prepared = {
  /** For drawing now: the texture-sized picture. */
  bitmap: ImageBitmap;
  aspect: number;
  texture: { blob: Blob; sha256: string };
  original: { blob: Blob; sha256: string };
};

const hexOf = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export const sha256Of = async (blob: Blob) => hexOf(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));

export async function prepare(file: Blob): Promise<Prepared> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("A PNG, JPEG or WebP picture, please");
  const full = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, TEXTURE_MAX / Math.max(full.width, full.height));
  const w = Math.max(1, Math.round(full.width * k)), h = Math.max(1, Math.round(full.height * k));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d")!.drawImage(full, 0, 0, w, h);
  full.close();
  let blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
  if (blob.type !== "image/webp") blob = await canvas.convertToBlob({ type: "image/png" }); // Safari before 17 has no WebP encoder
  const [ts, os] = await Promise.all([sha256Of(blob), sha256Of(file)]);
  return { bitmap: canvas.transferToImageBitmap(), aspect: w / h, texture: { blob, sha256: ts }, original: { blob: file, sha256: os } };
}
