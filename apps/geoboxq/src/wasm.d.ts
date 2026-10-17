// A Worker bundle imports a .wasm as a compiled module; Bun gives its path instead (engine.ts takes either).
declare module "*.wasm" { const module: WebAssembly.Module | string; export default module; }
