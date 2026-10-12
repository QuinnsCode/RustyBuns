"use server";
// Runs on the desktop host: the Rust rigger over bun:ffi, or the TypeScript
// one under Bun when there's no native build for this machine. The TypeScript
// one runs on a worker thread through the host's scheduler, so the host keeps
// serving while a mesh rigs (desktop.workers ships the module in the binary).
import { hostScheduler } from "@rustybuns/shell-bun/priority";
import type { RigOptions, RigResult } from "../rig/analyze.ts";
import { analyzeNative } from "../rig/native.ts";
import { f32, rigToWire, u32, type WireRig } from "../rig/codec.ts";

export interface HostRig { rig: WireRig; engine: "rust" | "ts"; platform: string; ms: number }

type Answer = { ok: true; r: RigResult; ms: number } | { ok: false; error: string };

async function analyzeOnWorker(pos: Float32Array, idx: Uint32Array, opts: Partial<RigOptions>): Promise<RigResult> {
  const a = await hostScheduler().worker<Answer>("high", new URL("../rig/worker.ts", import.meta.url), { pos, idx, opts }, { transfer: [pos.buffer, idx.buffer] });
  if (!a.ok) throw new Error(a.error);
  return a.r;
}

export async function rigOnHost(positions: string, indices: string, opts: Partial<RigOptions>, engine: "rust" | "ts" | "auto"): Promise<HostRig> {
  const pos = f32(positions), idx = u32(indices);
  const t0 = performance.now();
  const native = engine === "ts" ? null : await analyzeNative(pos, idx, opts);
  if (!native && engine === "rust") throw new Error("no Rust build for this platform (bun run build:native)");
  const r = native ?? await analyzeOnWorker(pos, idx, opts);
  return { rig: rigToWire(r), engine: native ? "rust" : "ts", platform: `${process.platform}-${process.arch}`, ms: performance.now() - t0 };
}
