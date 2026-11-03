// Builds a Splat Rooms scene from CC0 models, no scan and no training:
//   bun rooms/build.ts --theme parlour --seed 7 [--preview] [--out <dir>]
// 1. lays the room out from the seed (recipe.ts), 2. fetches the Poly Haven models and floor texture it
// needs (cached in ~/.cache/splat-rooms), 3. has headless Blender drop the props and cover every surface in
// splats (bake.py), 4. packs them into the compressed PLY the games read (pack.ts), beside labels.json,
// structure.json, occupancy.json and CREDITS.md. Output lands in the scenes folder as built_<theme>_<seed>.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { getJson } from "@rustybuns/util/http";
import { arr, num, obj, rec, str } from "@rustybuns/util/guard";
import { THEMES } from "./catalog.ts";
import { occupancy, recipe, structure } from "./recipe.ts";
import { packPly, ROW } from "./pack.ts";
import { planRound } from "../src/game/round.ts";

const { values: args } = parseArgs({
  options: {
    theme: { type: "string", default: "parlour" },
    seed: { type: "string", default: "1" },
    out: { type: "string" },
    preview: { type: "boolean", default: false },
  },
});
const theme = THEMES[args.theme!];
if (!theme) throw new Error(`no theme "${args.theme}"; have ${Object.keys(THEMES).join(", ")}`);
const seed = Number(args.seed);
const SCENES = (process.env.SPLAT_ROOMS_DIR ?? "~/Documents/SplatRooms").replace(/^~/, homedir());
const out = args.out ?? join(SCENES, `built_${args.theme}_${seed}`);
const CACHE = join(homedir(), ".cache/splat-rooms/polyhaven");
const API = "https://api.polyhaven.com";
mkdirSync(out, { recursive: true });

const Url = obj({ url: str(400) });
const ModelFiles = obj({ gltf: obj({ "1k": obj({ gltf: obj({ url: str(400), include: rec(Url, 64) }) }) }) });
const TexFiles = obj({ Diffuse: obj({ "1k": obj({ jpg: Url }) }) });
const Info = obj({ name: str(200), authors: rec(str(200), 16) });
const Credits = arr(obj({ id: str(200), name: str(200), by: str(400) }), 200);
const Corner = obj({ x: num(-1e4, 1e4), y: num(-1e4, 1e4), z: num(-1e4, 1e4) });
const Labels = arr(obj({ ins_id: str(20), label: str(200), bounding_box: arr(Corner, 8) }), 5000);

async function download(url: string, to: string) {
  if (existsSync(to)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  mkdirSync(dirname(to), { recursive: true });
  await Bun.write(`${to}.part`, res);
  await Bun.$`mv ${to}.part ${to}`.quiet();
}

/** One model's glTF and its textures, kept with their relative paths so the glTF resolves them. */
async function model(id: string): Promise<string> {
  const dir = join(CACHE, id);
  const gltf = join(dir, `${id}.gltf`);
  if (existsSync(gltf)) return gltf;
  const files = await getJson(`${API}/files/${id}`, ModelFiles);
  if (!files) throw new Error(`Poly Haven has no files for ${id}`);
  const g = files.gltf["1k"].gltf;
  await Promise.all(Object.entries(g.include).map(([rel, f]) => download(f.url, join(dir, rel))));
  await download(g.url, gltf);
  return gltf;
}

async function texture(id: string): Promise<string> {
  const to = join(CACHE, "textures", `${id}_diff_1k.jpg`);
  if (existsSync(to)) return to;
  const files = await getJson(`${API}/files/${id}`, TexFiles);
  if (!files) throw new Error(`Poly Haven has no texture ${id}`);
  await download(files.Diffuse["1k"].jpg.url, to);
  return to;
}

async function inBatches<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const res: R[] = [];
  for (let i = 0; i < xs.length; i += n) res.push(...(await Promise.all(xs.slice(i, i + n).map(f))));
  return res;
}

const r = recipe(theme, seed, args.theme);
const ids = [...new Set([...r.furniture, ...r.hangs, ...r.props].map((p) => p.asset))];
console.log(`${theme.name} #${seed}: ${r.room.w} x ${r.room.d} m, ${r.furniture.length} furniture, ${r.hangs.length} pictures, ${r.props.length} props (${ids.length} models)`);
const paths = await inBatches(ids, 6, model);
const assets = Object.fromEntries(ids.map((id, i) => [id, paths[i]!]));
const floor = await texture(r.room.floor);

const job = join(out, "job.json");
await Bun.write(job, JSON.stringify({ recipe: r, assets, floor, out, preview: args.preview }));
const blender = Bun.spawn(["blender", "-b", "--factory-startup", "-P", join(import.meta.dir, "bake.py"), "--", job], { stdout: "pipe", stderr: "pipe" });
for await (const line of blender.stdout.pipeThrough(new TextDecoderStream())) {
  for (const l of line.split("\n")) if (l.startsWith("[bake") || l.includes("Error")) console.log(l);
}
if ((await blender.exited) !== 0) throw new Error(`blender failed:\n${(await new Response(blender.stderr).text()).slice(-2000)}`);

const raw = new Float32Array(await Bun.file(join(out, "splats.bin")).arrayBuffer());
const ply = packPly(raw);
await Bun.write(join(out, "3dgs_compressed.ply"), ply);
rmSync(join(out, "splats.bin"));
rmSync(job);
await Bun.write(join(out, "structure.json"), JSON.stringify(structure(r), null, 1));
await Bun.write(join(out, "occupancy.json"), JSON.stringify(occupancy(r)));
await Bun.write(join(out, "recipe.json"), JSON.stringify(r, null, 1));

// Poly Haven asks for nothing (CC0), but naming the artists is cheap and kind.
const credits = await inBatches(ids, 6, async (id) => {
  const info = await getJson(`${API}/info/${id}`, Info);
  return { id, name: info?.name ?? id, by: Object.keys(info?.authors ?? {}).join(", ") };
});
const floorInfo = await getJson(`${API}/info/${r.room.floor}`, Info);
Credits(credits);
await Bun.write(join(out, "CREDITS.md"), [
  `# ${theme.name} #${seed}`, "",
  "Built by apps/splat-rooms/rooms from [Poly Haven](https://polyhaven.com) models and textures, all CC0 (https://polyhaven.com/license).", "",
  ...credits.map((c) => `- ${c.name} by ${c.by}: https://polyhaven.com/a/${c.id}`),
  `- floor: ${floorInfo?.name ?? r.room.floor} by ${Object.keys(floorInfo?.authors ?? {}).join(", ")}: https://polyhaven.com/a/${r.room.floor}`, "",
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
