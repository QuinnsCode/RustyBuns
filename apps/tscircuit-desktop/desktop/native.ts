// Host side of the Rust path: dlopen the tsci_analysis cdylib through
// @rustybuns/native. Null means it isn't built for this platform; callers
// fall back to the TypeScript twin and say so.
import { loadNative, platformTag } from "@rustybuns/native";
import { join } from "node:path";
import { CString, FFIType, type Pointer } from "bun:ffi";

export const tsciSymbols = {
  tsci_analyze: { args: [FFIType.ptr, FFIType.u64, FFIType.f64], returns: FFIType.ptr },
  tsci_free: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

// dir: the dev build next to this file, whatever the cwd. In the compiled
// binary that path doesn't exist and loadNative finds the embedded copy.
const lib = await loadNative("tsci_analysis", tsciSymbols, {
  dir: join(import.meta.dir, "..", "native", "dist", "tsci_analysis", platformTag()),
});

export const nativeAvailable = lib !== null;

/** Circuit JSON text in, analysis JSON text out. Null when the library isn't loaded. */
export function analyzeNative(circuitJson: string, minClearanceMm: number): string | null {
  if (!lib) return null;
  const input = Buffer.from(circuitJson);
  const p = lib.tsci_analyze(input, input.byteLength, minClearanceMm) as Pointer | null;
  if (!p) throw new Error("tsci_analyze returned null");
  try {
    return new CString(p).toString();
  } finally {
    lib.tsci_free(p);
  }
}
