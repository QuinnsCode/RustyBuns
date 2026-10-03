// Host-only: the Rust rigger through bun:ffi. null => no native build for this
// platform, and callers use the TypeScript one.
import { FFIType, ptr } from "bun:ffi";
import { loadNative } from "@rustybuns/native";
import { DEFAULT_OPTIONS, optionsArray, type RigOptions, type RigResult } from "./analyze.ts";

export const rigSymbols = {
  rig_analyze: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.ptr },
  rig_joint_count: { args: [FFIType.ptr], returns: FFIType.u32 },
  rig_joints: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  rig_weights: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  rig_info: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  rig_free: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

let lib: Awaited<ReturnType<typeof loadNative<typeof rigSymbols>>> | undefined;
export async function nativeLib() {
  if (lib === undefined) lib = await loadNative("auto_rig", rigSymbols);
  return lib;
}

export async function analyzeNative(pos: Float32Array, idx: Uint32Array, opts: Partial<RigOptions> = {}): Promise<RigResult | null> {
  const l = await nativeLib();
  if (!l) return null;
  const o = optionsArray({ ...DEFAULT_OPTIONS, ...opts });
  const h = l.rig_analyze(ptr(pos), pos.length / 3, ptr(idx), Math.floor(idx.length / 3), ptr(o));
  if (!h) throw new Error("the Rust rigger rejected this mesh");
  try {
    const J = l.rig_joint_count(h);
    const V = pos.length / 3;
    const joints = new Float32Array(J * 3), parents = new Int32Array(J);
    const skinIndex = new Uint16Array(V * 4), skinWeight = new Float32Array(V * 4);
    const info = new Float64Array(12);
    l.rig_joints(h, ptr(joints), ptr(parents));
    l.rig_weights(h, ptr(skinIndex), ptr(skinWeight));
    l.rig_info(h, ptr(info));
    return {
      joints, parents, skinIndex, skinWeight,
      grid: { dims: [info[0], info[1], info[2]], h: info[3], origin: [info[4], info[5], info[6]], solid: info[7] },
      timings: { voxelize: info[8], distance: info[9], skeleton: info[10], weights: info[11] },
    };
  } finally {
    l.rig_free(h);
  }
}
