// Where a rig gets computed. "host" lanes need the desktop app; "page" always works.
import type { RigOptions, RigResult } from "./analyze.ts";
import { rigFromWire, toB64 } from "./codec.ts";
import { rigOnHost } from "../actions/rig.ts";

export type Lane = "host-rust" | "host-ts" | "page-ts";
export const LANES: Record<Lane, string> = {
  "host-rust": "Rust · host (bun:ffi)",
  "host-ts": "TypeScript · host (Bun)",
  "page-ts": "TypeScript · page (Web Worker)",
};

export interface Run { rig: RigResult; lane: Lane; ms: number; note?: string }

export async function runPage(pos: Float32Array, idx: Uint32Array, opts: Partial<RigOptions>): Promise<Run> {
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  try {
    const out = await new Promise<{ ok: boolean; r?: RigResult; ms?: number; error?: string }>((res, rej) => {
      w.onmessage = (e) => res(e.data);
      w.onerror = (e) => rej(new Error(e.message));
      w.postMessage({ pos, idx, opts });
    });
    if (!out.ok) throw new Error(out.error);
    return { rig: out.r!, lane: "page-ts", ms: out.ms! };
  } finally {
    w.terminate();
  }
}

export async function runHost(pos: Float32Array, idx: Uint32Array, opts: Partial<RigOptions>, engine: "rust" | "ts" | "auto"): Promise<Run> {
  const h = await rigOnHost(toB64(pos), toB64(idx), opts, engine);
  return { rig: rigFromWire(h.rig), lane: h.engine === "rust" ? "host-rust" : "host-ts", ms: h.ms, note: h.platform };
}

/** Is there a desktop host behind this page? */
export async function hasHost(): Promise<boolean> {
  try { const r = await fetch("/__rb/info"); return r.ok && (await r.json()).caps?.ffi === true; } catch { return false; }
}

/** Fastest available: Rust on the host, else TypeScript on the host, else in the page. */
export async function runBest(pos: Float32Array, idx: Uint32Array, opts: Partial<RigOptions>): Promise<Run> {
  if (await hasHost()) { try { return await runHost(pos, idx, opts, "auto"); } catch (e) { console.warn("[auto-rig] host lane failed", e); } }
  return runPage(pos, idx, opts);
}
