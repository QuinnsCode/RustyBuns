// Build a proposal sheet and check its rig: `bun proposals/squonk/check.ts <id> [shot.png]`. Runs blender/beast.py on
// proposals/squonk/<id>.json, then the rigger's `analyze` and `feetOf` on the GLB as scripts/beasts.ts does, and with a
// shot path a close two-angle render of the GLB (proposals/squonk/close.py).
import { join } from "node:path";
import { analyze } from "@rustybuns/rig";
import { loadGlb } from "@rustybuns/rig/model";
import { feetOf } from "../../src/beasts.ts";

const APP = join(import.meta.dir, "..", "..");
const [id, shot] = process.argv.slice(2);
if (!id) { console.error("usage: bun proposals/squonk/check.ts <id> [shot.png]"); process.exit(1); }
const run = async (args: string[]) => {
  const p = Bun.spawn(args, { cwd: APP, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text() + await new Response(p.stderr).text();
  if ((await p.exited) !== 0) { console.error(out.split("\n").filter((l) => /Error|Traceback|line \d+/.test(l)).join("\n")); process.exit(1); }
  return out;
};
const out = await run(["blender", "-b", "--factory-startup", "--python-exit-code", "1", "-t", "8", "-P", "blender/beast.py", "--", `proposals/squonk/${id}.json`, "--render"]);
for (const l of out.split("\n").filter((l) => /triangles|render ->/.test(l))) console.log(l.trim());
const glb = join(APP, "public", "models", `${id}.glb`);
const model = await loadGlb(await Bun.file(glb).arrayBuffer(), id);
const r = analyze(model.positions, model.indices, { resolution: 96 });
const hasKids = new Array<boolean>(r.parents.length).fill(false);
for (const p of r.parents) if (p >= 0) hasKids[p] = true;
const tips: number[] = [];
for (let j = 1; j < r.parents.length; j++) if (!hasKids[j]) tips.push(j);
let height = 0;
for (let i = 1; i < model.positions.length; i += 3) height = Math.max(height, model.positions[i]!);
const sheet: unknown = await Bun.file(join(import.meta.dir, `${id}.json`)).json();
const want = typeof sheet === "object" && sheet !== null && "feet" in sheet ? sheet.feet : "?";
console.log(`${id}: ${model.triangles} tris, ${r.parents.length} joints, ${tips.length} tips, feet ${feetOf(r, tips, height).length}/${want}`);
if (shot) { await run(["blender", "-b", "--factory-startup", "-P", "proposals/squonk/close.py", "--", glb, shot]); console.log(`close -> ${shot}`); }
