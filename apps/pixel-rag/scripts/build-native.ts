// One crate, two builds:
//   native/dist/pixel_rag/<os>-<arch>/  the cdylib, for bun:ffi on the desktop host
//   public/pixel_rag.wasm               the same code for Web Workers on one shared memory
// Other OSes' cdylibs: build on that OS. The wasm is the same everywhere.
// --wasm: only the wasm (the web build runs this first). --optional: without cargo or the
// wasm32 target, say so and leave it to the TypeScript twin instead of failing. --lite: the cdylib
// without ONNX Runtime (~0.1 MB, not ~16 MB), for the lite desktop app: its window finds faces on
// onnxruntime-web, as a tab does.
import { $ } from "bun";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { patchShared, sharedWasmFlags } from "@rustybuns/util/wasm-shared";
import { MAX_PAGES } from "../src/engine/layout.ts";

const crate = "pixel_rag";
const tag = `${process.platform}-${process.arch}`;
const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";
const lib = (process.platform === "win32" ? "" : "lib") + crate + ext;
const manifest = "native/Cargo.toml";

if (process.argv.includes("--optional")) {
  const targets = await $`rustup target list --installed`.quiet().nothrow();
  if (targets.exitCode !== 0 || !targets.text().includes("wasm32-unknown-unknown")) {
    console.log("native: wasm skipped (needs cargo and `rustup target add wasm32-unknown-unknown`); the TypeScript twin runs instead");
    process.exit(0);
  }
}

if (!process.argv.includes("--wasm")) {
  const lite = process.argv.includes("--lite") ? ["--no-default-features"] : [];
  await $`cargo build --release --manifest-path ${manifest} ${lite}`;
  const out = join("native", "dist", crate, tag);
  await mkdir(out, { recursive: true });
  await copyFile(join("native", "target", "release", lib), join(out, lib));
  console.log(join(out, lib));
}

// Its own target dir: the RUSTFLAGS differ from the native build's.
await $`cargo build --release --target wasm32-unknown-unknown --target-dir native/target-wasm --manifest-path ${manifest}`
  .env({ ...process.env, RUSTFLAGS: sharedWasmFlags(2 << 20, MAX_PAGES * 65536) });
const raw = new Uint8Array(await Bun.file(join("native", "target-wasm", "wasm32-unknown-unknown", "release", `${crate}.wasm`)).arrayBuffer());
await mkdir("public", { recursive: true });
await writeFile(join("public", `${crate}.wasm`), patchShared(raw));
console.log(join("public", `${crate}.wasm`));
