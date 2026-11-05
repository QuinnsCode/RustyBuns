// Faces, off the page's thread: the page hands over a photo's RGBA bytes and this worker hands back
// its faces, so the page keeps responding however long they take. Two lanes:
//   wasm    the models on onnxruntime-web, here (~150 ms a photo)
//   native  the desktop host's own ONNX Runtime (src/actions/faces.ts); this worker does the base64
//           and the JSON the trip takes, which for a 1280x800 page is ~170 ms of a thread
// The tests run this same file as a Bun worker, which also keeps ONNX Runtime's wasm build off Bun's
// main thread (it takes over self.onmessage there: #3513).
import { facesOnHost, loadFacesOnHost } from "../actions/faces.ts";
import { findFaces, type Face, type Pixels } from "./face.ts";
import { wasmInfer } from "./run.ts";

export type FaceLaneId = "wasm" | "native";
export type FaceJob =
  /** Get a lane ready. wasm loads both models from `base` (the page's /models/, or a file:// directory under Bun). */
  | { type: "load"; lane: FaceLaneId; base: string; threads: number }
  | { type: "find"; id: number; data: Uint8Array | Uint8ClampedArray; width: number; height: number; page: number };
export type FaceReply =
  | { type: "loaded"; error?: string }
  | { type: "found"; id: number; faces: Face[]; ms: number; error?: string };

type Find = (p: Pixels, page: number) => Promise<Face[]>;
let find: Find | null = null;
const post = (r: FaceReply) => (self as unknown as Worker).postMessage(r);
const message = (e: unknown) => String(e instanceof Error ? e.message : e);

const B64 = new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
/** Bytes as base64 (an action's arguments travel as JSON): by table, ~10x quicker than btoa over char codes on a 4 MB page. */
export function base64(b: Uint8Array | Uint8ClampedArray): string {
  const out = new Uint8Array(Math.ceil(b.length / 3) * 4);
  let o = 0, i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out[o++] = B64[n >> 18]; out[o++] = B64[(n >> 12) & 63]; out[o++] = B64[(n >> 6) & 63]; out[o++] = B64[n & 63];
  }
  if (i < b.length) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8);
    out[o++] = B64[n >> 18]; out[o++] = B64[(n >> 12) & 63];
    out[o++] = i + 1 < b.length ? B64[(n >> 6) & 63] : 61; out[o++] = 61;
  }
  return new TextDecoder().decode(out);
}

async function load(j: Extract<FaceJob, { type: "load" }>): Promise<Find> {
  if (j.lane === "native") {
    await loadFacesOnHost();
    return async (p, page) => (await facesOnHost(base64(p.data), p.width, p.height, page)).map((f) => ({ ...f, vec: Float32Array.from(f.vec) }));
  }
  const infer = await wasmInfer(async (file) => {
    const r = await fetch(new URL(file, j.base));
    if (!r.ok || (r.headers.get("content-type") ?? "").includes("html")) throw new Error(`no ${file} at ${j.base}: run \`bun run models\``);
    return new Uint8Array(await r.arrayBuffer());
  }, j.threads);
  return (p, page) => findFaces(infer, p, page);
}

// With wasm threads on, ONNX Runtime starts its thread workers from this same bundled file (named
// em-pthread-*), and its own handler must keep their messages: only the face worker takes them here.
const pthread = typeof self.name === "string" && self.name.startsWith("em-pthread");

if (!pthread) self.onmessage = async (e: MessageEvent<FaceJob>) => {
  const j = e.data;
  if (j.type === "load") {
    try {
      find = await load(j);
      post({ type: "loaded" });
    } catch (err) {
      post({ type: "loaded", error: message(err) });
    }
    return;
  }
  const t0 = performance.now();
  try {
    if (!find) throw new Error("find before load");
    post({ type: "found", id: j.id, faces: await find(j, j.page), ms: performance.now() - t0 });
  } catch (err) {
    post({ type: "found", id: j.id, faces: [], ms: 0, error: message(err) });
  }
};
