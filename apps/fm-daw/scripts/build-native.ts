// One crate, two builds:
//   native/dist/fm_daw/<os>-<arch>/  the cdylib, for bun:ffi on the host (golden test, host bench)
//   public/fm_daw.wasm               the same engine for the AudioWorklet (live audio)
// Other OSes' cdylibs: build on that OS. The wasm is the same everywhere.
import { $ } from "bun";
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
const crate = "fm_daw";
const tag = `${process.platform}-${process.arch}`;
const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";
const lib = (process.platform === "win32" ? "" : "lib") + crate + ext;
const manifest = "native/Cargo.toml";

await $`cargo build --release --manifest-path ${manifest}`;
const out = join("native", "dist", crate, tag);
await mkdir(out, { recursive: true });
await copyFile(join("native", "target", "release", lib), join(out, lib));
console.log(join(out, lib));

await $`cargo build --release --target wasm32-unknown-unknown --manifest-path ${manifest}`;
await mkdir("public", { recursive: true });
await copyFile(join("native", "target", "wasm32-unknown-unknown", "release", `${crate}.wasm`), join("public", `${crate}.wasm`));
console.log(join("public", `${crate}.wasm`));
