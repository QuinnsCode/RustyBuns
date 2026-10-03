// native/dist/auto_rig/<os>-<arch>/: the cdylib, for bun:ffi on the host.
// Other OSes' libraries: build on that OS.
import { $ } from "bun";
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
const crate = "auto_rig";
const tag = `${process.platform}-${process.arch}`;
const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";
const lib = (process.platform === "win32" ? "" : "lib") + crate + ext;

await $`cargo build --release --manifest-path native/Cargo.toml`;
const out = join("native", "dist", crate, tag);
await mkdir(out, { recursive: true });
await copyFile(join("native", "target", "release", lib), join(out, lib));
console.log(join(out, lib));
