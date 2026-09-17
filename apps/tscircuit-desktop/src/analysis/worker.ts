// In-browser engine: the same Rust crate compiled to wasm when
// public/native/tsci_analysis.wasm exists (bun native/build.ts --wasm),
// otherwise the TypeScript twin. Runs off the main thread either way.
import { analyze } from "./analyze.ts";

interface WasmExports {
  memory: WebAssembly.Memory;
  tsci_alloc(len: number): number;
  tsci_dealloc(ptr: number, len: number): void;
  tsci_analyze(ptr: number, len: number, min: number): number;
  tsci_free(ptr: number): void;
}

const wasm: Promise<WasmExports | null> = (async () => {
  try {
    const res = await fetch("/native/tsci_analysis.wasm");
    if (!res.ok) return null;
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
    return instance.exports as unknown as WasmExports;
  } catch {
    return null;
  }
})();

function runWasm(w: WasmExports, text: string, min: number): string {
  const bytes = new TextEncoder().encode(text);
  const p = w.tsci_alloc(bytes.length);
  new Uint8Array(w.memory.buffer, p, bytes.length).set(bytes);
  const out = w.tsci_analyze(p, bytes.length, min);
  w.tsci_dealloc(p, bytes.length);
  const mem = new Uint8Array(w.memory.buffer);   // re-read: memory may have grown
  let end = out;
  while (mem[end] !== 0) end++;
  const json = new TextDecoder().decode(mem.subarray(out, end));
  w.tsci_free(out);
  return json;
}

self.onmessage = async (e: MessageEvent<{ id: number; text: string; min: number }>) => {
  const { id, text, min } = e.data;
  const w = await wasm;
  const t0 = performance.now();
  try {
    const result = w ? JSON.parse(runWasm(w, text, min)) : analyze(JSON.parse(text), min);
    postMessage({ id, engine: w ? "rust-wasm" : "ts-worker", ms: +(performance.now() - t0).toFixed(2), result });
  } catch (err) {
    postMessage({ id, error: String((err as Error).message ?? err) });
  }
};
