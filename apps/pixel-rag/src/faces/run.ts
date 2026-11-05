// The two face models on ONNX Runtime's wasm build: in the page's face worker (face-worker.ts, the
// tab's and the desktop window's) and under Bun for the tests. Nothing leaves the machine. Only the
// worker imports this file, and only once a photo comes in, so the 12 MB runtime and the 10 MB of
// weights load then, off the page's thread.
import * as ort from "onnxruntime-web/wasm";
import { MODELS, type Infer } from "./face.ts";

/** Both sessions, from `get(file)`'s bytes. `threads`: wasm threads (needs cross-origin isolation in a page). */
export async function wasmInfer(get: (file: string) => Promise<Uint8Array>, threads = 1): Promise<Infer> {
  ort.env.wasm.numThreads = threads;
  ort.env.logLevel = "error";
  const open = async (file: string) => ort.InferenceSession.create(await get(file), { executionProviders: ["wasm"], logSeverityLevel: 3 });
  const [detect, embed] = await Promise.all([open(MODELS.detect.file), open(MODELS.embed.file)]);
  return async (model, input, side) => {
    const s = model === "detect" ? detect : embed;
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, side, side]) });
    const planes: Record<string, Float32Array> = {};
    for (const k of s.outputNames) if (out[k].data instanceof Float32Array) planes[k] = out[k].data;
    return planes;
  };
}
