// Host-only: the crate through bun:ffi. null => no native build for this platform.
// Desktop builds: darwin-arm64, darwin-x64, linux and windows, each through desktop-drop.yml.
import { FFIType } from "bun:ffi";
import { loadNative } from "@rustybuns/native";

export const symbols = {
  pr_embed: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.void },
  pr_dhash: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32], returns: FFIType.u64 },
  pr_quantize: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.void },
  pr_fill: { args: [FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.void },
  pr_topk: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
  pr_features: { args: [], returns: FFIType.u32 },
} as const;

/** The face models on the ONNX Runtime linked into the crate (src/infer.rs; src/faces/native.ts). Not in the lite build. */
export const faceSymbols = {
  pr_ort_open: { args: [FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.ptr },
  pr_ort_close: { args: [FFIType.ptr], returns: FFIType.void },
  pr_ort_outputs: { args: [FFIType.ptr], returns: FFIType.u32 },
  pr_ort_output_name: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  pr_ort_run: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
} as const;

let lib: Awaited<ReturnType<typeof loadNative<typeof symbols>>> | undefined;
export async function nativeLib() {
  if (lib === undefined) lib = await loadNative("pixel_rag", symbols);
  return lib;
}

let faces: Awaited<ReturnType<typeof loadNative<typeof faceSymbols>>> | undefined;
/** The face symbols, or null: no native build, or the lite one (built without ONNX Runtime). */
export async function nativeFaces() {
  if (faces === undefined) faces = (((await nativeLib())?.pr_features() ?? 0) & 1) ? await loadNative("pixel_rag", faceSymbols) : null;
  return faces;
}
