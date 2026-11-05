// The two face models on ONNX Runtime's wasm build, on this machine: in the tab (and the desktop
// app's window) and under Bun for the tests. Nothing leaves it. The page imports this file only
// when a photo comes in, so the 12 MB runtime and the 10 MB of weights load only then.
import * as ort from "onnxruntime-web/wasm";
import { crop, CROP, decode, DETECT, FEATS, letterbox, MODELS, unit, type Face, type Pixels } from "./face.ts";

export interface FaceModels { detect: ort.InferenceSession; embed: ort.InferenceSession }

/** Both sessions, from `get(file)`'s bytes. `threads`: wasm threads (needs cross-origin isolation in a page). */
export async function loadModels(get: (file: string) => Promise<Uint8Array>, threads = 1): Promise<FaceModels> {
  ort.env.wasm.numThreads = threads;
  ort.env.logLevel = "error";
  const open = async (file: string) => ort.InferenceSession.create(await get(file), { executionProviders: ["wasm"], logSeverityLevel: 3 });
  const [detect, embed] = await Promise.all([open(MODELS.detect.file), open(MODELS.embed.file)]);
  return { detect, embed };
}

/** Every face on a picture, fingerprinted. */
export async function findFaces(m: FaceModels, p: Pixels, page: number): Promise<Face[]> {
  const { input, scale } = letterbox(p);
  const out = await m.detect.run({ [m.detect.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, DETECT, DETECT]) });
  const planes: Record<string, Float32Array> = {};
  for (const [k, t] of Object.entries(out)) if (t.data instanceof Float32Array) planes[k] = t.data;
  const faces: Face[] = [];
  for (const f of decode(planes, scale)) {
    const e = await m.embed.run({ [m.embed.inputNames[0]]: new ort.Tensor("float32", crop(p, f.kps), [1, 3, CROP, CROP]) });
    const v = e[m.embed.outputNames[0]].data;
    if (!(v instanceof Float32Array) || v.length !== FEATS) throw new Error(`face fingerprint: expected ${FEATS} floats`);
    faces.push({ ...f, page, vec: unit(v) });
  }
  return faces;
}
