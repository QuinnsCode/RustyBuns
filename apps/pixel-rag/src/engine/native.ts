// Host-only: the crate through bun:ffi. null => no native build for this platform.
import { FFIType } from "bun:ffi";
import { loadNative } from "@rustybuns/native";

export const symbols = {
  pr_embed: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.void },
  pr_dhash: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32], returns: FFIType.u64 },
  pr_quantize: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.void },
  pr_fill: { args: [FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.void },
  pr_topk: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
} as const;

let lib: Awaited<ReturnType<typeof loadNative<typeof symbols>>> | undefined;
export async function nativeLib() {
  if (lib === undefined) lib = await loadNative("pixel_rag", symbols);
  return lib;
}
