// Let several wasm instances (in different workers) run on ONE shared WebAssembly.Memory.
// Stable Rust can't link --shared-memory (its prebuilt core has no atomics), so a crate is
// built with `+atomics --import-memory --max-memory=...` and this patch finishes the job.
// Plain bytes in, bytes out: it runs in a page, a Web Worker or Bun.

/**
 * Two fixes:
 *  - the memory import is `env.memory` with limits flags 0x01 (has max); make it 0x03 (shared + max).
 *  - drop the start section. lld's start function `memory.fill`s the whole bss with zeros on
 *    EVERY instantiation, so each late-starting worker would wipe what the others wrote.
 *    A fresh WebAssembly.Memory is already zeroed, so nothing is lost.
 */
export function patchShared(wasm: Uint8Array): Uint8Array {
  const out = wasm.slice();
  const needle = new TextEncoder().encode("\x03env\x06memory\x02\x01");
  let shared = false;
  outer: for (let i = 0; i + needle.length < out.length; i++) {
    for (let j = 0; j < needle.length; j++) if (out[i + j] !== needle[j]) continue outer;
    out[i + needle.length - 1] = 0x03;
    shared = true;
    break;
  }
  if (!shared) throw new Error("wasm: no env.memory import with a max to mark shared");
  const parts: Uint8Array[] = [out.subarray(0, 8)];
  let i = 8;
  while (i < out.length) {
    const start = i, id = out[i++];
    let size = 0, shift = 0, b: number;
    do { b = out[i++]; size |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    i += size;
    if (id !== 8) parts.push(out.subarray(start, i));
  }
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { joined.set(p, at); at += p.length; }
  return joined;
}

/** The RUSTFLAGS for a crate whose wasm build imports a shared memory of at most `maxBytes`. */
export function sharedWasmFlags(initialBytes: number, maxBytes: number): string {
  return `-C target-feature=+atomics,+bulk-memory -C link-arg=--import-memory -C link-arg=--initial-memory=${initialBytes} -C link-arg=--max-memory=${maxBytes} -C link-arg=--export=__stack_pointer -C link-arg=--export=__heap_base`;
}
