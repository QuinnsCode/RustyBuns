// Host-only: the Rust engine through bun:ffi. null => this host has no native
// build (Cloudflare, or a platform nobody compiled), and callers use TsEngine.
import { FFIType } from "bun:ffi";
import { loadNative } from "@rustybuns/native";
import type { Renderer } from "./bounce.ts";

export const motionMidiSymbols = {
  mm_new: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  mm_total_frames: { args: [FFIType.ptr], returns: FFIType.f64 },
  mm_render: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.u32 },
  mm_free: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

let lib: Awaited<ReturnType<typeof loadNative<typeof motionMidiSymbols>>> | undefined;
export async function nativeLib() {
  if (lib === undefined) lib = await loadNative("motion_midi", motionMidiSymbols);
  return lib;
}

export async function createRustEngine(song: Float32Array): Promise<Renderer | null> {
  const l = await nativeLib();
  if (!l) return null;
  const h = l.mm_new(song, song.length);
  if (!h) throw new Error("rust engine rejected the song");
  let alive = true;
  return {
    totalFrames: l.mm_total_frames(h),
    render: (out, frames) => l.mm_render(h, out, Math.min(frames * 2, out.length)),
    free: () => { if (alive) { alive = false; l.mm_free(h); } },
  };
}
