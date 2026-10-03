// Host-only: the Rust engine through bun:ffi. null => no native build for this
// platform (or Cloudflare), and callers use TsEngine.
import { FFIType, ptr } from "bun:ffi";
import { loadNative } from "@rustybuns/native";
import type { FmEngine } from "./engine.ts";

export const fmSymbols = {
  fm_new: { args: [FFIType.f64], returns: FFIType.ptr },
  fm_free: { args: [FFIType.ptr], returns: FFIType.void },
  fm_set_param: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.f64], returns: FFIType.void },
  fm_set_mute: { args: [FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.void },
  fm_set_master: { args: [FFIType.ptr, FFIType.f64], returns: FFIType.void },
  fm_note_on: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.f64, FFIType.f64], returns: FFIType.void },
  fm_note_off: { args: [FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.void },
  fm_all_off: { args: [FFIType.ptr], returns: FFIType.void },
  fm_panic: { args: [FFIType.ptr], returns: FFIType.void },
  fm_click: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.void },
  fm_render: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.void },
  fm_meter: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
} as const;

let lib: Awaited<ReturnType<typeof loadNative<typeof fmSymbols>>> | undefined;
export async function nativeLib() {
  if (lib === undefined) lib = await loadNative("fm_daw", fmSymbols);
  return lib;
}

export async function createNativeEngine(sampleRate: number): Promise<FmEngine | null> {
  const l = await nativeLib();
  if (!l) return null;
  const h = l.fm_new(sampleRate);
  if (!h) throw new Error("rust engine rejected the sample rate");
  let alive = true;
  return {
    setParam: (t, i, v) => l.fm_set_param(h, t >>> 0, i >>> 0, v),
    setMute: (t, m) => l.fm_set_mute(h, t >>> 0, m ? 1 : 0),
    setMaster: (g) => l.fm_set_master(h, g),
    noteOn: (t, id, midi, vel) => l.fm_note_on(h, t >>> 0, id >>> 0, midi, vel),
    noteOff: (t, id) => l.fm_note_off(h, t >>> 0, id >>> 0),
    allOff: () => l.fm_all_off(h),
    panic: () => l.fm_panic(h),
    click: (a) => l.fm_click(h, a ? 1 : 0),
    render: (out, frames) => l.fm_render(h, ptr(out), Math.min(frames, out.length >> 1)),
    meter: (out) => l.fm_meter(h, ptr(out)),
    free: () => { if (alive) { alive = false; l.fm_free(h); } },
  };
}
