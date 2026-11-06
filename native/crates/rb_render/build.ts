// cargo build rb_render (its own workspace: Blitz is a long compile) into
// native/dist/rb_render/<os>-<arch>/, where loadNative("rb_render") looks.
// Run from the repo root, on the builder: bun run builder run . bun native/crates/rb_render/build.ts
import { $ } from "bun";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const tag = `${process.platform}-${process.arch}`;
const lib = process.platform === "win32" ? "rb_render.dll" : process.platform === "darwin" ? "librb_render.dylib" : "librb_render.so";
const target = join("native", "target", "rb_render");
await $`cargo build --release --manifest-path native/crates/rb_render/Cargo.toml --target-dir ${target}`;
const out = join("native", "dist", "rb_render", tag);
await mkdir(out, { recursive: true });
await copyFile(join(target, "release", lib), join(out, lib));
console.log(join(out, lib));
