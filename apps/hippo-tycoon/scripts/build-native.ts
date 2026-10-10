// The Rust crates to WebAssembly: public/hippo_fluid.wasm (the geyser's fluid) and
// public/hippo_sim.wasm (the game's step()). Optional: without them the game runs
// the TypeScript twins (same output).
import { $ } from "bun";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const crates = ["hippo_fluid", "hippo_sim"];
// --optional: the client builds run this first. Without cargo or the wasm32
// target, say so and leave it to the TypeScript twin instead of failing the build.
if (process.argv.includes("--optional")) {
  const targets = await $`rustup target list --installed`.quiet().nothrow();
  if (targets.exitCode !== 0 || !targets.text().includes("wasm32-unknown-unknown")) {
    console.log("native: wasm skipped (needs cargo and `rustup target add wasm32-unknown-unknown`); the TypeScript twin runs instead");
    process.exit(0);
  }
}
await $`cargo build --release --target wasm32-unknown-unknown --manifest-path native/Cargo.toml`;
await mkdir("public", { recursive: true });
for (const crate of crates) {
  await copyFile(join("native", "target", "wasm32-unknown-unknown", "release", `${crate}.wasm`), join("public", `${crate}.wasm`));
  console.log(join("public", `${crate}.wasm`));
}
