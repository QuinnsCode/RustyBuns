// Two things PGlite's Emscripten runtime expects that workerd lacks:
// - self.location (href, pathname), for its script directory;
// - compiling WASM at runtime: addFunction builds a tiny module per callback signature. workerd forbids
//   that, so record-callbacks.ts recorded those modules' bytes in Bun and the bundle ships them precompiled;
//   here `new WebAssembly.Module(bytes)` hands back the precompiled one for the same bytes.
import { callbacks } from "./cb/index.ts";

const g = globalThis as { location?: URL };
g.location ??= new URL("file:///bundle/worker.js");

const Orig = WebAssembly.Module;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const Patched = function (bytes: BufferSource) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer);
  const pre = b.length < 256 ? callbacks[hex(b)] : undefined;
  if (pre) return pre;
  throw new Error(`no precompiled callback for ${hex(b)}: rerun record-callbacks.ts`);
} as unknown as typeof WebAssembly.Module;
Patched.prototype = Orig.prototype;
Object.assign(Patched, { imports: Orig.imports, exports: Orig.exports, customSections: Orig.customSections });
(WebAssembly as { Module: typeof WebAssembly.Module }).Module = Patched;
