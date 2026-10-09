// The fluid's Rust crate to WebAssembly: public/hippo_fluid.wasm. Optional: without
// it the game runs the TypeScript twin of the same simulation (same output, a bit slower).
import { $ } from "bun";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const crate = "hippo_fluid";
// --optional: the client builds run this first. Without cargo or the wasm32
// target, say so and leave it to the TypeScript twin instead of failing the build.
if (process.argv.includes("--optional")) {
  const targets = await $`rustup target list --installed`.quiet().nothrow();
  if (targets.exitCode !== 0 || !targets.text().includes("wasm32-unknown-unknown")) {
    console.log("fluid: wasm skipped (needs cargo and `rustup target add wasm32-unknown-unknown`); the TypeScript twin runs instead");
    process.exit(0);
  }
}
await $`cargo build --release --target wasm32-unknown-unknown --manifest-path rust/Cargo.toml`;
await mkdir("public", { recursive: true });
await copyFile(join("rust", "target", "wasm32-unknown-unknown", "release", `${crate}.wasm`), join("public", `${crate}.wasm`));
console.log(join("public", `${crate}.wasm`));
