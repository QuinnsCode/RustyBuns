// A .wasm import in the Worker bundle is the compiled module (src/edge.ts).
declare module "*.wasm" {
  const mod: WebAssembly.Module;
  export default mod;
}
