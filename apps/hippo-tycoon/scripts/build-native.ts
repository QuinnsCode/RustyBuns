// The fluid's Rust crate to WebAssembly: public/hippo_fluid.wasm. Optional: without
// it the game runs the TypeScript twin of the same simulation (same output, a bit slower).
import { $ } from "bun";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const crate = "hippo_fluid";
await $`cargo build --release --target wasm32-unknown-unknown --manifest-path rust/Cargo.toml`;
await mkdir("public", { recursive: true });
await copyFile(join("rust", "target", "wasm32-unknown-unknown", "release", `${crate}.wasm`), join("public", `${crate}.wasm`));
console.log(join("public", `${crate}.wasm`));
