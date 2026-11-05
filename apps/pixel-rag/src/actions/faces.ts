"use server";
// Runs on the desktop host: the face models on the ONNX Runtime linked into the crate, over bun:ffi
// (src/faces/native.ts), instead of onnxruntime-web in the page's worker. The page sends a photo's
// RGBA bytes; the host answers with its faces, found by the same face.ts math as the wasm lane.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findFaces, MODELS, type Face, type Infer } from "../faces/face.ts";
import { nativeInfer } from "../faces/native.ts";

/** A face as JSON carries it: the fingerprint as plain numbers. */
export type WireFace = Omit<Face, "vec"> & { vec: number[] };

/** The models the page is served: inside the binary beside the client, or the working tree's in dev. */
function modelDir(): string {
  const dirs = [join(import.meta.dir, "desktop", "models"), join(process.cwd(), "dist", "desktop", "models"), join(process.cwd(), "public", "models")];
  const dir = dirs.find((d) => Object.values(MODELS).every((m) => existsSync(join(d, m.file))));
  if (!dir) throw new Error("no face models on the host: run `bun run models`, then build the desktop app");
  return dir;
}

let infer: Promise<Infer> | null = null;
const ready = () => {
  infer ??= nativeInfer(modelDir()).catch((e) => { infer = null; throw e; });
  return infer;
};

/** Loads both models natively; rejects with why not. */
export async function loadFacesOnHost(): Promise<{ platform: string }> {
  await ready();
  return { platform: `${process.platform}-${process.arch}` };
}

/** A side in pixels, as the page sends it. */
function side(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 8192) throw new Error(`facesOnHost: ${n} isn't a picture side`);
  return n;
}

export async function facesOnHost(rgba: unknown, width: unknown, height: unknown, page: unknown): Promise<WireFace[]> {
  const w = side(width), h = side(height);
  if (typeof rgba !== "string" || typeof page !== "number") throw new Error("facesOnHost: (base64 rgba, width, height, page)");
  const data = new Uint8Array(Buffer.from(rgba, "base64"));
  if (data.length !== w * h * 4) throw new Error(`facesOnHost: ${data.length} bytes for ${w}x${h}`);
  const faces = await findFaces(await ready(), { data, width: w, height: h }, page);
  return faces.map((f) => ({ ...f, vec: [...f.vec] }));
}
