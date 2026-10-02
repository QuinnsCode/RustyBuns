// The Rust crate compiled to wasm32 (bun native/build.ts builds it when the
// target is installed). Plain extern "C" exports, no wasm-bindgen: write the
// input into Rust's memory, call, read the NUL-terminated result back.

export interface WasmExports {
  memory: WebAssembly.Memory;
  tsci_alloc(len: number): number;
  tsci_dealloc(ptr: number, len: number): void;
  tsci_analyze(ptr: number, len: number, min: number): number;
  tsci_free(ptr: number): void;
}

export async function loadWasm(bytes: BufferSource): Promise<WasmExports> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports as unknown as WasmExports;
}

/** Circuit JSON text in, analysis JSON text out. */
export function runWasm(w: WasmExports, text: string, min: number): string {
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
