// Build the beasts: `bun scripts/beasts.ts [--render] [--rig-only] [id ...]`. Each sheet in beasts/ goes
// through Blender (blender/beast.py: the mesh, public/models/<id>.glb, and with --render a contact sheet in
// blender/out/<id>.png to look at), then through auto-rig's voxel rigger, which finds its skeleton and skin
// weights and writes public/models/<id>.rig.json with the feet marked. Prints one row per beast; a beast
// whose feet count doesn't match its sheet is a bug in the sheet (a leg merged into the body, or a tail
// that touches the ground) and the row says so.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { int, num, obj, oneOf, str } from "@rustybuns/util/guard";
import { analyze } from "../../auto-rig/src/rig/analyze.ts";
import { rigToWire } from "../../auto-rig/src/rig/codec.ts";
import { loadGlb } from "../../auto-rig/src/ui/model.ts";
import { feetOf, wingsOf, type BeastRig } from "../src/beasts.ts";
import { ARCHETYPES } from "../src/roster.ts";

const APP = join(import.meta.dir, "..");
const Sheet = obj({ id: str(40, { re: /^[a-z0-9-]+$/ }), name: str(40), archetype: oneOf(ARCHETYPES), feet: int(0, 8), budget: num(100, 20000, 3000) });

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const picked = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ids = readdirSync(join(APP, "beasts")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => picked.length === 0 || picked.includes(id));
if (ids.length === 0) { console.error("no beast sheets matched"); process.exit(1); }

async function blender(id: string): Promise<string[]> {
  const args = ["blender", "-b", "--factory-startup", "-P", "blender/beast.py", "--", `beasts/${id}.json`, ...(flags.has("--render") ? ["--render"] : [])];
  const p = Bun.spawn(args, { cwd: APP, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text() + await new Response(p.stderr).text();
  if ((await p.exited) !== 0) throw new Error(`blender failed on ${id}:\n${out.split("\n").filter((l) => /Error|Traceback|line \d+/.test(l)).join("\n")}`);
  return out.split("\n").filter((l) => /triangles|render ->/.test(l));
}

async function rig(id: string, feet: number) {
  const glb = Bun.file(join(APP, "public", "models", `${id}.glb`));
  const model = await loadGlb(await glb.arrayBuffer(), id);
  const t0 = performance.now();
  const r = analyze(model.positions, model.indices, { resolution: 96 });
  const ms = performance.now() - t0;
  const tips: number[] = [];
  const hasKids = new Array<boolean>(r.parents.length).fill(false);
  for (const p of r.parents) if (p >= 0) hasKids[p] = true;
  for (let j = 1; j < r.parents.length; j++) if (!hasKids[j]) tips.push(j);
  let height = 0, extent = 0;
  for (let i = 0; i < model.positions.length; i += 3) {
    height = Math.max(height, model.positions[i + 1]!);
    extent = Math.max(extent, Math.abs(model.positions[i]!) * 2, Math.abs(model.positions[i + 2]!) * 2);
  }
  const found = feetOf(r, tips, height);
  const wings = wingsOf(r, tips, height, extent).filter((t) => !found.includes(t));
  const sidecar: BeastRig = { ...rigToWire(r), tips, feet: found, wings, height: +height.toFixed(4), extent: +extent.toFixed(4) };
  await Bun.write(join(APP, "public", "models", `${id}.rig.json`), JSON.stringify(sidecar));
  return { joints: r.parents.length, tips: tips.length, feet: found.length, wings: wings.length, ms, ok: found.length === feet, tris: model.triangles };
}

const rows = await Promise.all(ids.map(async (id) => {
  const sheet = Sheet(await Bun.file(join(APP, "beasts", `${id}.json`)).json());
  const notes = flags.has("--rig-only") ? [] : await blender(id);
  const r = await rig(id, sheet.feet);
  return { id, sheet, notes, r };
}));
for (const { id, sheet, notes, r } of rows) {
  for (const n of notes) console.log(`  ${n}`);
  console.log(`${r.ok ? "ok " : "!! "}${id.padEnd(14)} ${sheet.archetype.padEnd(10)} ${String(r.tris).padStart(5)} tris  ${String(r.joints).padStart(3)} joints  ${String(r.tips).padStart(2)} tips  feet ${r.feet}/${sheet.feet}  wings ${r.wings}  rigged in ${r.ms.toFixed(0)} ms`);
}
if (rows.some((x) => !x.r.ok)) { console.error("a beast's feet don't match its sheet"); process.exit(1); }
