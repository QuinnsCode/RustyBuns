// cargo build every crate as a cdylib for THIS platform into native/dist/.
// Cross-OS builds are a CI matrix; this script is one cell of it.
import { $ } from "bun";
import { mkdir, readdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
const tag = `${process.platform}-${process.arch}`;
const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";
await $`cargo build --release --manifest-path native/Cargo.toml`;
for (const crate of await readdir("native/crates")) {
  // A crate that is its own workspace (rb_render) has its own build script.
  if (/^\[workspace\]/m.test(await Bun.file(join("native", "crates", crate, "Cargo.toml")).text())) continue;
  const lib = (process.platform === "win32" ? "" : "lib") + crate + ext;
  const out = join("native", "dist", crate, tag);
  await mkdir(out, { recursive: true });
  await copyFile(join("native", "target", "release", lib), join(out, lib));
  console.log(`native/dist/${crate}/${tag}/${lib}`);
}
