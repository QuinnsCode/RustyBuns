// Builds the Rust roller (wasm/) to src/dice.wasm: `cargo build --target wasm32-unknown-unknown --release`, then a
// copy. The crate has no dependencies and no wasm-bindgen, so this is the whole toolchain: rustup, the wasm32 target
// (`rustup target add wasm32-unknown-unknown`), cargo. src/dice.wasm is checked in, so CI and `bun run dev` never
// compile Rust. With the builder valve shut: `bun run builder run apps/pwa-example bun scripts/wasm.ts --b64`, which
// prints the module as base64 for `bun scripts/wasm.ts --from <file>` to write here.
import { copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { help } from "../../../scripts/help.ts";

if (process.argv.includes("--help")) { help(import.meta.path); process.exit(0); }
const crate = join(import.meta.dir, "../wasm"), dest = join(import.meta.dir, "../src/dice.wasm");
const from = process.argv.indexOf("--from");
if (from > 0) {
  writeFileSync(dest, Buffer.from(readFileSync(process.argv[from + 1]!, "utf8").trim(), "base64"));
} else {
  const build = Bun.spawnSync(["cargo", "build", "--release", "--target", "wasm32-unknown-unknown"], { cwd: crate, stdout: "inherit", stderr: "inherit" });
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
  copyFileSync(join(crate, "target/wasm32-unknown-unknown/release/pocket_dice.wasm"), dest);
  if (process.argv.includes("--b64")) console.log(readFileSync(dest).toString("base64"));
}
console.error(`${dest}: ${statSync(dest).size} bytes`);
