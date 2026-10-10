// The Rust crates to WebAssembly: public/hippo_fluid.wasm (the geyser's fluid) and
// public/hippo_sim.wasm (the game's step()). Optional: without them the game runs
// the TypeScript twins (same output).
//
// It also writes native/hippo_sim.wasm, the copy src/edge.ts bundles into the
// Worker. That import must resolve, so a build without cargo writes an empty
// module there instead (simModule() reads it as "no Rust sim").
import { $ } from "bun";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const crates = ["hippo_fluid", "hippo_sim"];
const EDGE = join("native", "hippo_sim.wasm");
await mkdir("native", { recursive: true });
// --optional: the client builds run this first. Without cargo or the wasm32
// target, say so and leave it to the TypeScript twin instead of failing the build.
if (process.argv.includes("--optional")) {
  const targets = await $`rustup target list --installed`.quiet().nothrow();
  if (targets.exitCode !== 0 || !targets.text().includes("wasm32-unknown-unknown")) {
    console.log("native: wasm skipped (needs cargo and `rustup target add wasm32-unknown-unknown`); the TypeScript twin runs instead");
    if (!existsSync(EDGE)) await writeFile(EDGE, new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));   // "\0asm", version 1, nothing else
    process.exit(0);
  }
}
await $`cargo build --release --target wasm32-unknown-unknown --manifest-path rust/Cargo.toml`;
await mkdir("public", { recursive: true });
for (const crate of crates) {
  await copyFile(join("rust", "target", "wasm32-unknown-unknown", "release", `${crate}.wasm`), join("public", `${crate}.wasm`));
  console.log(join("public", `${crate}.wasm`));
}
await copyFile(join("public", "hippo_sim.wasm"), EDGE);
console.log(EDGE);
