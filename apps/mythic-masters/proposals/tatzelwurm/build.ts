// Build each candidate, check the rig finds its feet, and render a close-up:
// `bun proposals/tatzelwurm/build.ts <close.py> <out dir> [museum|museum2 ...]`.
import { join } from "node:path";
import { analyze } from "@rustybuns/rig";
import { loadGlb } from "@rustybuns/rig/model";
import { feetOf } from "../../src/beasts.ts";

const APP = join(import.meta.dir, "../..");
const [close, out, ...which] = process.argv.slice(2);
for (const name of which.length ? which : ["museum", "museum2"]) {
  const id = `tatzelwurm-${name}`;
  const want = (await Bun.file(join(APP, `proposals/tatzelwurm/${id}.json`)).json()).feet;
  const b = Bun.spawnSync(["blender", "-b", "--factory-startup", "--python-exit-code", "1", "-t", "8", "-P", "blender/beast.py", "--", `proposals/tatzelwurm/${id}.json`, "--render"], { cwd: APP });
  const log = b.stdout.toString() + b.stderr.toString();
  if (b.exitCode !== 0) { console.log(`!! ${id} blender failed\n${log.split("\n").slice(-15).join("\n")}`); continue; }
  const glb = join(APP, "public/models", `${id}.glb`);
  const model = await loadGlb(await Bun.file(glb).arrayBuffer(), id);
  const r = analyze(model.positions, model.indices, { resolution: 96 });
  const kids = new Set(r.parents.filter((p) => p >= 0));
  const tips = r.parents.map((_, j) => j).filter((j) => j > 0 && !kids.has(j));
  let height = 0;
  for (let i = 1; i < model.positions.length; i += 3) height = Math.max(height, model.positions[i]!);
  const feet = feetOf(r, tips, height).length;
  Bun.spawnSync(["blender", "-b", "--factory-startup", "-P", close!, "--", glb, join(out!, `${name}.png`)]);
  console.log(`${feet === want ? "ok" : "!!"} ${id}: ${model.triangles} tris, feet ${feet}/${want},${log.match(/[\d.]+ long.*tall/)?.[0] ?? ""}`);
}
