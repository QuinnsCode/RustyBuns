// Host-only: the two face models on the ONNX Runtime linked into the crate (native/crates/pixel_rag
// /src/infer.rs), over bun:ffi. Native code, so ONNX Runtime's wasm build and its grab for Bun's
// self.onmessage never come into it. The math around the runs is face.ts, as on the wasm lane.
import { join } from "node:path";
import { nativeLib } from "../engine/native.ts";
import { MODELS, type Infer } from "./face.ts";

/** Room for every output of one run: YuNet's twelve come to 8400 anchors x 16 floats. */
const CAP = 1 << 18;
const RUN_ERRORS: Record<number, string> = { [-1]: "the run failed", [-2]: "an output isn't f32", [-3]: "the outputs don't fit" };

/** Both models from `dir`, on `threads` ONNX Runtime threads each (0: its own choice). */
export async function nativeInfer(dir: string, threads = 0): Promise<Infer> {
  const lib = await nativeLib();
  if (!lib) throw new Error("no Rust build for this platform (bun run build:native)");
  const open = async (file: string) => {
    const bytes = new Uint8Array(await Bun.file(join(dir, file)).arrayBuffer());
    const handle = lib.pr_ort_open(bytes, bytes.length, threads);
    if (!handle) throw new Error(`${file}: ONNX Runtime couldn't load it`);
    const names: string[] = [], buf = new Uint8Array(256);
    for (let i = 0; i < lib.pr_ort_outputs(handle); i++) names.push(new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, lib.pr_ort_output_name(handle, i, buf, buf.length)))));
    return { handle, names };
  };
  const models = { detect: await open(MODELS.detect.file), embed: await open(MODELS.embed.file) };
  const out = new Float32Array(CAP);
  return async (model, input, side) => {
    const { handle, names } = models[model], lens = new Uint32Array(names.length);
    const rc = lib.pr_ort_run(handle, input, 3, side, side, out, CAP, lens);
    if (rc !== 0) throw new Error(`${MODELS[model].file}: ${RUN_ERRORS[rc] ?? `error ${rc}`}`);
    const planes: Record<string, Float32Array> = {};
    let at = 0;
    names.forEach((n, i) => { planes[n] = out.slice(at, at + lens[i]); at += lens[i]; });
    return planes;
  };
}
