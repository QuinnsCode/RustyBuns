// Shared bits of the genome stress: build both flavours of rb_genome, patch the
// wasm so it can import a *shared* memory, and the FFI symbol table.
import { FFIType } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

export const NATIVE_DIR = join(import.meta.dir, "..");
const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";
export const NATIVE_LIB = join(NATIVE_DIR, "target", "release", (process.platform === "win32" ? "" : "lib") + "rb_genome" + ext);
export const WASM_FILE = join(NATIVE_DIR, "target-wasm", "wasm32-unknown-unknown", "release", "rb_genome.wasm");
export const STACK_SLICE = 32 * 1024; // each wasm instance gets its own slice of the module's 1 MiB shadow stack
export const PAGES = 64; // 4 MiB; must match --initial-memory/--max-memory below

export const symbols = {
  rb_genome_words:       { args: [FFIType.u32, FFIType.u32], returns: FFIType.u32 },
  rb_genome_init:        { args: [FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.void },
  rb_genome_hammer:      { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u64], returns: FFIType.u32 },
  rb_genome_verify:      { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32], returns: FFIType.u32 },
  rb_genome_racy_tears:  { args: [FFIType.ptr], returns: FFIType.u32 },
} as const;

export async function build(): Promise<void> {
  if (!existsSync(NATIVE_LIB)) {
    await $`cargo build --release --manifest-path ${join(NATIVE_DIR, "Cargo.toml")} -p rb_genome`.quiet();
  }
  if (!existsSync(WASM_FILE)) {
    // Stable's prebuilt core has no atomics, so we can't link --shared-memory. Compile OUR crate
    // with +atomics (core::sync::atomic inlines into it), import the memory, and flip the
    // memory import to "shared" in patchShared().
    const bytes = PAGES * 65536;
    const flags = `-C target-feature=+atomics -C link-arg=--import-memory -C link-arg=--initial-memory=${bytes} -C link-arg=--max-memory=${bytes} -C link-arg=--export=__stack_pointer`;
    await $`cargo build --release -p rb_genome --target wasm32-unknown-unknown --target-dir ${join(NATIVE_DIR, "target-wasm")} --manifest-path ${join(NATIVE_DIR, "Cargo.toml")}`
      .env({ ...process.env, RUSTFLAGS: flags }).quiet();
  }
}

/**
 * Two fixes so several instances can share one memory:
 *  - the memory import is `env.memory` with limits flags 0x01 (has max); make it 0x03 (shared + max).
 *  - drop the start section. lld's start function `memory.fill`s the whole bss (our genome slab) with
 *    zeros on EVERY instantiation, so each late-starting worker wiped what the others had counted.
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
  if (!shared) throw new Error("rb_genome.wasm: no env.memory import with a max to mark shared");
  const parts: Uint8Array[] = [out.subarray(0, 8)];
  let i = 8;
  while (i < out.length) {
    const start = i, id = out[i++];
    let size = 0, shift = 0, b: number;
    do { b = out[i++]; size |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    i += size;
    if (id !== 8) parts.push(out.subarray(start, i));
  }
  return Buffer.concat(parts);
}

export type WorkerJob = {
  kind: "native" | "wasm";
  memory: WebAssembly.Memory;
  slab: number;       // byte offset of the genome inside the shared memory
  genes: number; parts: number; id: number; iters: number; seed: bigint;
};
export type WorkerResult = { id: number; kind: string; torn: number; ms: number };
