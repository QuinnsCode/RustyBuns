// Shared bits of the genome stress: build both flavours of rb_genome, the FFI symbol
// table, and patchShared (from @rustybuns/util) so the wasm imports a *shared* memory.
import { FFIType } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
export { patchShared } from "../../packages/util/src/wasm-shared.ts";

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

export type WorkerJob = {
  kind: "native" | "wasm";
  memory: WebAssembly.Memory;
  slab: number;       // byte offset of the genome inside the shared memory
  genes: number; parts: number; id: number; iters: number; seed: bigint;
};
export type WorkerResult = { id: number; kind: string; torn: number; ms: number };
