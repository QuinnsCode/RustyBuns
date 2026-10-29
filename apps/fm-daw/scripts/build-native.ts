// One crate, two builds:
//   native/dist/fm_daw/<os>-<arch>/  the cdylib, for bun:ffi on the host (golden test, host bench)
//   public/fm_daw.wasm               the same engine for the AudioWorklet (live audio)
// Other OSes' cdylibs: build on that OS. The wasm is the same everywhere.
// --wasm: only the wasm (the web build runs this first). --optional: without cargo or
// the wasm32 target, say so and leave it to the TypeScript engine instead of failing.
import { $ } from "bun";
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
const crate = "fm_daw";
const tag = `${process.platform}-${process.arch}`;
const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";
const lib = (process.platform === "win32" ? "" : "lib") + crate + ext;
const manifest = "native/Cargo.toml";

if (process.argv.includes("--optional")) {
  const targets = await $`rustup target list --installed`.quiet().nothrow();
  if (targets.exitCode !== 0 || !targets.text().includes("wasm32-unknown-unknown")) {
    console.log("native: wasm skipped (needs cargo and `rustup target add wasm32-unknown-unknown`); the TypeScript engine runs instead");
    process.exit(0);
  }
}

if (!process.argv.includes("--wasm")) {
  await $`cargo build --release --manifest-path ${manifest}`;
  const out = join("native", "dist", crate, tag);
  await mkdir(out, { recursive: true });
  await copyFile(join("native", "target", "release", lib), join(out, lib));
  console.log(join(out, lib));
}

await $`cargo build --release --target wasm32-unknown-unknown --manifest-path ${manifest}`;
await mkdir("public", { recursive: true });
await copyFile(join("native", "target", "wasm32-unknown-unknown", "release", `${crate}.wasm`), join("public", `${crate}.wasm`));
console.log(join("public", `${crate}.wasm`));
