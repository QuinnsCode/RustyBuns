// Host side of the Rust path: dlopen the tsci_analysis cdylib through
// @rustybuns/native. Null means it isn't built for this platform; callers
// fall back to the TypeScript twin and say so.
import { loadNative, platformTag } from "@rustybuns/native";
import { join } from "node:path";
import { CString, FFIType, JSCallback, type Pointer } from "bun:ffi";

export const tsciSymbols = {
  tsci_analyze: { args: [FFIType.ptr, FFIType.u64, FFIType.f64], returns: FFIType.ptr },
  tsci_analyze_async: { args: [FFIType.ptr, FFIType.u64, FFIType.f64, FFIType.u32, FFIType.function], returns: FFIType.void },
  tsci_free: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

// dir: the dev build next to this file, whatever the cwd. In the compiled
// binary that path doesn't exist and loadNative finds the embedded copy.
const lib = await loadNative("tsci_analysis", tsciSymbols, {
  dir: join(import.meta.dir, "..", "native", "dist", "tsci_analysis", platformTag()),
});

export const nativeAvailable = lib !== null;

function take(p: Pointer | null): string {
  if (!p) throw new Error("tsci_analyze returned null");
  try {
    return new CString(p).toString();
  } finally {
    lib!.tsci_free(p);
  }
}

/** Circuit JSON text in, analysis JSON text out, blocking. Null when the library isn't loaded. */
export function analyzeNative(circuitJson: string, minClearanceMm: number): string | null {
  if (!lib) return null;
  const input = Buffer.from(circuitJson);
  return take(lib.tsci_analyze(input, input.byteLength, minClearanceMm) as Pointer | null);
}

// The async path: Rust runs the analysis on its own thread and calls this back.
// threadsafe: the call arrives from that thread and Bun queues it onto the
// event loop, so the host keeps serving files and saves while Rust works.
const waiting = new Map<number, (out: string) => void>();
let nextId = 0;
const done = lib && new JSCallback(
  (id: number, p: Pointer | null) => {
    const resolve = waiting.get(id);
    waiting.delete(id);
    resolve?.(take(p));
  },
  { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void, threadsafe: true },
);

/** analyzeNative without blocking the event loop. Null when the library isn't loaded. */
export function analyzeNativeAsync(circuitJson: string, minClearanceMm: number): Promise<string> | null {
  if (!lib || !done) return null;
  const id = ++nextId >>> 0;
  const input = Buffer.from(circuitJson);   // Rust copies it before the call returns
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    lib.tsci_analyze_async(input, input.byteLength, minClearanceMm, id, done);
  });
}
