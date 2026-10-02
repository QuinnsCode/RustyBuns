// In-browser engine: the same Rust crate compiled to wasm when
// public/native/tsci_analysis.wasm exists (bun native/build.ts builds it),
// otherwise the TypeScript twin. Runs off the main thread either way.
import { analyze } from "./analyze.ts";
import { loadWasm, runWasm, type WasmExports } from "./wasm.ts";

const wasm: Promise<WasmExports | null> = (async () => {
  try {
    const res = await fetch("/native/tsci_analysis.wasm");
    return res.ok ? await loadWasm(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
})();

self.onmessage = async (e: MessageEvent<{ id: number; text: string; min: number }>) => {
  const { id, text, min } = e.data;
  const w = await wasm;
  const t0 = performance.now();
  try {
    const result = w ? JSON.parse(runWasm(w, text, min)) : analyze(JSON.parse(text), min);
    if (result.error) throw new Error(result.error);
    postMessage({ id, engine: w ? "rust-wasm" : "ts-worker", ms: +(performance.now() - t0).toFixed(2), result });
  } catch (err) {
    postMessage({ id, error: String((err as Error).message ?? err) });
  }
};
