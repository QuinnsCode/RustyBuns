// Build every crate in native/crates for THIS platform into native/dist/<crate>/<os-arch>/,
// where @rustybuns/native's loadNative() and `rustybuns build desktop` look.
//   bun native/build.ts          native cdylib (bun:ffi on the host), plus a .wasm into
//                                public/native/ for the browser worker when the wasm32
//                                target is installed (rustup target add wasm32-unknown-unknown)
//   bun native/build.ts --wasm   require the .wasm: fail instead of skipping it
import { $ } from "bun";
import { mkdir, readdir, copyFile } from "node:fs/promises";
import { join } from "node:path";

const tag = `${process.platform}-${process.arch}`;
const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";
const crates = await readdir("native/crates");

await $`cargo build --release --manifest-path native/Cargo.toml`;
for (const crate of crates) {
  const lib = (process.platform === "win32" ? "" : "lib") + crate + ext;
  const out = join("native", "dist", crate, tag);
  await mkdir(out, { recursive: true });
  await copyFile(join("native", "target", "release", lib), join(out, lib));
  console.log(`native  native/dist/${crate}/${tag}/${lib}`);
}

const wasmTarget = (await $`rustup target list --installed`.quiet().nothrow().text()).includes("wasm32-unknown-unknown");
if (!wasmTarget && process.argv.includes("--wasm")) throw new Error("--wasm: run `rustup target add wasm32-unknown-unknown` first");
if (!wasmTarget) console.log("wasm    skipped (rustup target add wasm32-unknown-unknown to build it)");
else {
  // Same crate, same extern "C" exports, single-threaded (no rayon in wasm).
  await $`cargo build --release --manifest-path native/Cargo.toml --target wasm32-unknown-unknown --no-default-features`;
  await mkdir("public/native", { recursive: true });
  for (const crate of crates) {
    await copyFile(join("native", "target", "wasm32-unknown-unknown", "release", `${crate}.wasm`), join("public", "native", `${crate}.wasm`));
    console.log(`wasm    public/native/${crate}.wasm`);
  }
}
