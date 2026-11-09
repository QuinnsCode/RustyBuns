// Turn the games' glTF models into USDZ, the format iOS reads natively (RealityKit, SceneKit, Quick Look):
//   bun run usdz                      every apps/*/public/models/*.glb into dist/ios/<app>/
//   bun run usdz mythic-masters       one app
//   bun run usdz models               the procedural models in packages/models (roadster, plants) into dist/ios/models/
//   bun run usdz beasts               Mythic Masters' beasts as skinned USDZ (UsdSkel) into dist/ios/mythic-masters/beasts/; no Blender needed
// Headless Blender does the work (scripts/usdz/convert.py); BLENDER_PATH picks a Blender other than the one on PATH.
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { writeProceduralGlbs } from "../packages/models/src/catalog.ts";
import { findBlender, runBlender } from "../packages/cli/src/blender.ts";

if (Bun.argv.slice(2).includes("beasts")) {
  const { exportBeasts } = await import("./usdz/beasts.ts");
  const n = await exportBeasts("apps/mythic-masters/public/models", "dist/ios/mythic-masters/beasts");
  console.log(`mythic-masters beasts: ${n} skinned models -> dist/ios/mythic-masters/beasts/`);
  process.exit(0);
}

if (!findBlender()) throw new Error("no Blender: install it or set BLENDER_PATH");

const argv = Bun.argv.slice(2);
const wantModels = !argv.length || argv.includes("models");
const named = argv.filter((a) => a !== "models");
const apps = (named.length ? named : argv.length ? [] : readdirSync("apps")).filter((app) => existsSync(`apps/${app}/public/models`));
if (!apps.length && !wantModels) throw new Error(`no public/models in ${named.join(", ")}`);

// Each batch is [label, out dir, glbs]; the procedural models are written out first, to a scratch dir removed after.
const scratch = "dist/ios/.glb";
const batches: [string, string, string[]][] = apps.map((app) => [app, `dist/ios/${app}`, readdirSync(`apps/${app}/public/models`).filter((f) => f.endsWith(".glb")).map((f) => `apps/${app}/public/models/${f}`)]);
if (wantModels) {
  mkdirSync(scratch, { recursive: true });
  batches.push(["models", "dist/ios/models", await writeProceduralGlbs(scratch)]);
}

for (const [app, out, glbs] of batches) {
  if (!glbs.length) continue;
  const r = await runBlender({ script: "scripts/usdz/convert.py", args: [out, ...glbs] });
  const baked = (r.out + r.err).split("\n").filter((l) => / baked=[1-9]/.test(l)).length;
  console.log(`${app}: ${glbs.length} models -> ${out}/${baked ? ` (${baked} painted with vertex colours, baked to textures)` : ""}`);
}
rmSync(scratch, { recursive: true, force: true });
