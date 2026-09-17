// Build every crate in native/crates for THIS platform into native/dist/<crate>/<os-arch>/,
// where @rustybuns/native's loadNative() and `rustybuns build desktop` look.
//   bun native/build.ts          native cdylib (bun:ffi on the host)
//   bun native/build.ts --wasm   also a .wasm into public/native/ for the browser worker
//                                (needs: rustup target add wasm32-unknown-unknown)
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

if (process.argv.includes("--wasm")) {
  // Same crate, same extern "C" exports, single-threaded (no rayon in wasm).
  await $`cargo build --release --manifest-path native/Cargo.toml --target wasm32-unknown-unknown --no-default-features`;
  await mkdir("public/native", { recursive: true });
  for (const crate of crates) {
    await copyFile(join("native", "target", "wasm32-unknown-unknown", "release", `${crate}.wasm`), join("public", "native", `${crate}.wasm`));
    console.log(`wasm    public/native/${crate}.wasm`);
  }
}
