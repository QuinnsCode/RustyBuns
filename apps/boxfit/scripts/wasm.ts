// Build the Rust engine (wasm/) to src/wasm-pkg with wasm-pack and tidy what it drops there.
// The output is checked in: CI never runs cargo. Run from anywhere: `bun run wasm` in apps/boxfit.
import { existsSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const app = resolve(import.meta.dir, "..");
const crate = join(app, "wasm");
const out = join(app, "src", "wasm-pkg");

const build = Bun.spawnSync(
  ["wasm-pack", "build", crate, "--target", "web", "--release", "--out-dir", out, "--out-name", "boxfit_engine", "--no-pack"],
  { stdout: "inherit", stderr: "inherit", env: { ...process.env, CARGO_TARGET_DIR: join(crate, "target") } },
);
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

// wasm-pack writes an npm package; we import the files directly, so these only get in the way.
for (const f of [".gitignore", "package.json", "README.md", "LICENSE"]) {
  const p = join(out, f);
  if (existsSync(p)) rmSync(p);
}

const wasm = join(out, "boxfit_engine_bg.wasm");
const kb = statSync(wasm).size / 1024;
console.log(`${wasm}: ${kb.toFixed(1)} KB`);
if (kb > 160) {
  console.error("boxfit_engine_bg.wasm is over the 160 KB budget");
  process.exit(1);
}
