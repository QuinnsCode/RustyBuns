// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
// A .wasm import: Cloudflare hands over the compiled module (Alchemy's CompiledWasm rule), Bun the file's path.
declare module "*.wasm" {
  const wasm: WebAssembly.Module | string;
  export default wasm;
}
// This one ships its own .d.ts (wasm-bindgen's view of its exports), which hides the default import above.
declare module "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" {
  const wasm: WebAssembly.Module | string;
  export default wasm;
}
