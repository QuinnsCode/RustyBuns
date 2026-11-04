// Renders every catalog model (or one theme's) front-on into one contact sheet, to check each `turn`:
//   bun rooms/fronts.ts [--theme kitchen] [--out fronts.png]
//   bun rooms/fronts.ts --ids sofa_02,Shelf_01 --out turns.png      (each model at 0, 90, 180 and 270)
// A red tab marks the side that should be the front. A model showing its back or side there needs a `turn`.
// It also measures each model and names any whose catalog size is off by more than 10 cm, since layouts
// keep furniture apart by those sizes.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { THEMES } from "./catalog.ts";
import { inBatches, model } from "./polyhaven.ts";

const { values: args } = parseArgs({
  options: { theme: { type: "string" }, ids: { type: "string" }, out: { type: "string", default: "fronts.png" } },
});
const themes = args.theme ? [THEMES[args.theme]] : Object.values(THEMES);
if (themes.some((t) => !t)) throw new Error(`no theme "${args.theme}"; have ${Object.keys(THEMES).join(", ")}`);
const only = args.ids?.split(",");
const seen = new Map<string, { label: string; turn: number; size: number[] }>();
for (const t of only ? Object.values(THEMES) : themes) for (const a of t!.assets) {
  if (!only || only.includes(a.id)) seen.set(a.id, { label: a.label, turn: a.turn ?? 0, size: a.size });
}
const ids = [...seen.keys()];
const paths = await inBatches(ids, 6, model);
const out = resolve(args.out!);
const job = join(import.meta.dir, ".fronts.json");
await Bun.write(job, JSON.stringify({ models: ids.map((id, i) => [id, seen.get(id)!.label, seen.get(id)!.turn, paths[i]]), out, turns: only ? [0, 90, 180, 270] : undefined }));
const p = Bun.spawn(["blender", "-b", "--factory-startup", "-P", join(import.meta.dir, "fronts.py"), "--", job], { stdout: "pipe", stderr: "inherit" });
const log = await new Response(p.stdout).text();
await Bun.file(job).delete();
if ((await p.exited) !== 0) throw new Error(log.slice(-2000));
for (const l of log.split("\n")) {
  if (l.startsWith("[fronts] ")) console.log(l);
  const m = /^\[fronts-size\] (\S+) (\[.*\])$/.exec(l);
  const want = m && seen.get(m[1]!);
  if (!m || !want || only) continue;
  const got = (JSON.parse(m[2]!) as unknown[]).map(Number);
  if (got.some((v, i) => Math.abs(v - want.size[i]!) > 0.1)) console.log(`size off: ${m[1]} catalog [${want.size}] measured [${got}]`);
}
