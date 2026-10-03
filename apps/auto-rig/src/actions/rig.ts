"use server";
// Runs on the desktop host: the Rust rigger over bun:ffi, or the TypeScript
// one under Bun when there's no native build for this machine.
import { analyze, type RigOptions } from "../rig/analyze.ts";
import { analyzeNative } from "../rig/native.ts";
import { f32, rigToWire, u32, type WireRig } from "../rig/codec.ts";

export interface HostRig { rig: WireRig; engine: "rust" | "ts"; platform: string; ms: number }

export async function rigOnHost(positions: string, indices: string, opts: Partial<RigOptions>, engine: "rust" | "ts" | "auto"): Promise<HostRig> {
  const pos = f32(positions), idx = u32(indices);
  const t0 = performance.now();
  const native = engine === "ts" ? null : await analyzeNative(pos, idx, opts);
  if (!native && engine === "rust") throw new Error("no Rust build for this platform (bun run build:native)");
  const r = native ?? analyze(pos, idx, opts);
  return { rig: rigToWire(r), engine: native ? "rust" : "ts", platform: `${process.platform}-${process.arch}`, ms: performance.now() - t0 };
}
