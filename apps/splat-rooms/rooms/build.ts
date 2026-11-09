// Builds a Splat Rooms scene from CC0 models, no scan and no training:
//   bun rooms/build.ts --theme parlour --seed 7 [--preview] [--out <dir>]
// 1. lays the room out from the seed (recipe.ts), 2. fetches the Poly Haven models and floor texture it
// needs (cached in ~/.cache/splat-rooms), 3. has headless Blender drop the props and cover every surface in
// splats (bake.py), 4. packs them into the compressed PLY the games read (pack.ts), beside labels.json,
// structure.json, occupancy.json and CREDITS.md. Output lands in the scenes folder as built_<theme>_<seed>.
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { arr, num, obj, str } from "@rustybuns/util/guard";
import { runBlender } from "@rustybuns/cli/blender";
import { THEMES } from "./catalog.ts";
import { credit, hdri, inBatches, model, texture } from "./polyhaven.ts";
import { occupancy, recipe, structure } from "./recipe.ts";
import { packPly, ROW } from "./pack.ts";
import { planRound } from "../src/game/round.ts";

const { values: args } = parseArgs({
  options: {
    theme: { type: "string", default: "parlour" },
    seed: { type: "string", default: "1" },
    out: { type: "string" },
    samples: { type: "string", default: "128" },
    device: { type: "string", default: "CPU" },
    preview: { type: "boolean", default: false },
  },
});
const theme = THEMES[args.theme!];
if (!theme) throw new Error(`no theme "${args.theme}"; have ${Object.keys(THEMES).join(", ")}`);
const seed = Number(args.seed);
const SCENES = (process.env.SPLAT_ROOMS_DIR ?? "~/Documents/SplatRooms").replace(/^~/, homedir());
const out = args.out ?? join(SCENES, `built_${args.theme}_${seed}`);
await Bun.$`mkdir -p ${out}`.quiet();

const Credits = arr(obj({ id: str(200), name: str(200), by: str(400) }), 200);
const Corner = obj({ x: num(-1e4, 1e4), y: num(-1e4, 1e4), z: num(-1e4, 1e4) });
const Labels = arr(obj({ ins_id: str(20), label: str(200), bounding_box: arr(Corner, 8) }), 5000);

const r = recipe(theme, seed, args.theme);
const ids = [...new Set([...r.furniture, ...r.hangs, ...r.fixtures, ...r.props].map((p) => p.asset))];
const windows = r.openings.filter((o) => o.kind === "window").length;
console.log(`${theme.name} #${seed}: ${r.room.w} x ${r.room.d} m, ${r.furniture.length} furniture, ${r.hangs.length} pictures, ${r.fixtures.length} lamps, ${windows} windows, ${r.props.length} props (${ids.length} models)`);
const paths = await inBatches(ids, 6, model);
const assets = Object.fromEntries(ids.map((id, i) => [id, paths[i]!]));
const floor = await texture(r.room.floor);
const sky = await hdri(r.room.sky);

const job = join(out, "job.json");
await Bun.write(job, JSON.stringify({ recipe: r, assets, floor, sky, out, preview: args.preview, samples: Number(args.samples), device: args.device }));
await runBlender({ script: join(import.meta.dir, "bake.py"), args: [job], onLine: (l) => { if (l.startsWith("[bake") || l.includes("Error")) console.log(l); } });

const raw = new Float32Array(await Bun.file(join(out, "splats.bin")).arrayBuffer());
const ply = packPly(raw);
await Bun.write(join(out, "3dgs_compressed.ply"), ply);
rmSync(join(out, "splats.bin"));
rmSync(job);
await Bun.write(join(out, "structure.json"), JSON.stringify(structure(r), null, 1));
await Bun.write(join(out, "occupancy.json"), JSON.stringify(occupancy(r)));
await Bun.write(join(out, "recipe.json"), JSON.stringify(r, null, 1));

// Poly Haven asks for nothing (CC0), but naming the artists is cheap and kind.
const credits = await inBatches(ids, 6, credit);
const [floorInfo, skyInfo] = await Promise.all([credit(r.room.floor), credit(r.room.sky)]);
Credits(credits);
await Bun.write(join(out, "CREDITS.md"), [
  `# ${theme.name} #${seed}`, "",
  "Built by apps/splat-rooms/rooms from [Poly Haven](https://polyhaven.com) models and textures, all CC0 (https://polyhaven.com/license).", "",
  ...credits.map((c) => `- ${c.name} by ${c.by}: https://polyhaven.com/a/${c.id}`),
  `- floor: ${floorInfo.name} by ${floorInfo.by}: https://polyhaven.com/a/${r.room.floor}`,
  `- sky: ${skyInfo.name} by ${skyInfo.by}: https://polyhaven.com/a/${r.room.sky}`, "",
].join("\n"));

// Does the hunt accept it? Plan twenty rounds and count the different things they ask for.
const objects = Labels(JSON.parse(await Bun.file(join(out, "labels.json")).text()));
const targets = new Set<string>();
let planned = 0;
for (let s = 1; s <= 20; s++) {
  const round = planRound({ objects, structure: structure(r) }, { seed: s });
  if (round) { planned++; targets.add(round.target.label); }
}
console.log(`${(raw.length / ROW / 1000).toFixed(0)}k splats, ${(ply.length / 1e6).toFixed(1)} MB, ${objects.length} labelled objects`);
console.log(`rounds: ${planned}/20 planned, ${targets.size} different targets (${[...targets].join(", ")})`);
console.log(`-> ${out}`);
