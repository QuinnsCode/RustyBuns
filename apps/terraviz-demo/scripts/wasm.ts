// Build the Rust tour reader (wasm/) with wasm-pack into sphere/tour-pkg/, then write sphere/tour-pkg.ts, which
// carries the glue and the wasm (base64) as strings for the Worker to serve. Both outputs are checked in: CI never
// runs cargo. From anywhere: `bun apps/terraviz-demo/scripts/wasm.ts`.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const app = resolve(import.meta.dir, "..");
const crate = join(app, "wasm");
const out = join(app, "sphere", "tour-pkg");

const build = Bun.spawnSync(
  ["wasm-pack", "build", crate, "--target", "web", "--release", "--out-dir", out, "--out-name", "sphere_tour", "--no-pack"],
  { stdout: "inherit", stderr: "inherit", env: { ...process.env, CARGO_TARGET_DIR: join(crate, "target") } },
);
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
for (const f of [".gitignore", "package.json", "README.md", "LICENSE"]) if (existsSync(join(out, f))) rmSync(join(out, f));

const wasm = join(out, "sphere_tour_bg.wasm");
const kb = statSync(wasm).size / 1024;
console.log(`${wasm}: ${kb.toFixed(1)} KB`);
if (kb > 200) { console.error("sphere_tour_bg.wasm is over the 200 KB budget"); process.exit(1); }

writeFileSync(join(app, "sphere", "tour-pkg.ts"), [
  "// Written by scripts/wasm.ts from wasm/: the tour reader's glue and binary, as strings the Worker serves.",
  `export const TOUR_GLUE = ${JSON.stringify(readFileSync(join(out, "sphere_tour.js"), "utf8"))};`,
  `export const TOUR_WASM_B64 = ${JSON.stringify(readFileSync(wasm).toString("base64"))};`,
  "",
].join("\n"));
