// Grow the native plants: `bun run flora [id ...] [--render] [--jobs N]`. Each spec in flora/ goes through Blender
// (blender/flora.py) and comes out as public/models/flora/<id>.glb: a near model and a far one (`<id>-lo`), standing
// on their foot, vertex-coloured with the occlusion baked in. Prints one row per plant: its triangles against its
// budget. The game lists the plants it plants in GROWN (src/world/flora.ts) and where they grow in FLORA.
//
// The loop for making or varying one, no game needed:
//   bun run flora <id> --render            the GLB, and blender/out/flora/<id>.png: near from two sides, far beside it, a 1.8 m post
//   bun run flora <id> --variants 4        the spec grown from 4 seeds in a row (blender/out/flora/<id>.variants.png); put the
//                                          one you like in the spec's `seed`
//   bun run flora <id> --watch             rebuild and re-render on every save of flora/<id>.json
//   bun run flora --lineup [biome ...]     every plant of a biome side by side at its height: blender/out/flora/lineup-<biome>.png
//
// A new plant is a new spec (copy the nearest one: a tree, a shrub, a rosette, a cactus), its id in GROWN, and a row
// in its biome's FLORA list. Knobs are documented at the top of blender/flora.py.
import { readdirSync, readFileSync, watch } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { arr, num, obj, oneOf, str, type Of } from "@rustybuns/util/guard";

const APP = join(import.meta.dir, "..");
const DIR = join(APP, "flora");
const Spec = obj({
  id: str(40, { re: /^[a-z0-9-]+$/ }), name: str(60), biome: str(30), generator: oneOf(["tree", "rosette", "cactus", "knees"] as const),
  height: num(0.05, 120), budget: arr(num(50, 20000), 2, { min: 2 }),
});

const argv = process.argv.slice(2);
const opt = (flag: string) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
const jobs = Number(opt("--jobs") ?? Math.max(1, Math.floor(availableParallelism() / 2)));
const variants = opt("--variants"), seed = opt("--seed");
const valued = new Set(["--jobs", "--variants", "--seed"]);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const picked = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1] ?? ""));

/** Every spec, read and checked. */
function specs() {
  return readdirSync(DIR).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const raw: unknown = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    let s: Of<typeof Spec>;
    try { s = Spec(raw); } catch (e) { throw new Error(`flora/${f}: ${e instanceof Error ? e.message : String(e)}`); }
    if (s.id !== f.slice(0, -5)) throw new Error(`flora/${f}: id ${s.id} doesn't match the file name`);
    return s;
  });
}

/** Runs Blender on flora.py with these arguments; resolves to its output, or throws with its tail. */
async function blender(args: string[]): Promise<string> {
  const p = Bun.spawn(["blender", "-b", "--factory-startup", "--python-exit-code", "1", "-P", join(APP, "blender/flora.py"), "--", ...args], { cwd: APP, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`blender ${args.join(" ")} failed:\n${(out + err).split("\n").slice(-25).join("\n")}`);
  return out;
}
/** The lines worth showing from a build: triangles, size, files written. */
const report = (out: string) => out.split("\n").filter((l) => /triangles|tall|^-> |^render -> /.test(l)).map((l) => "  " + l.trim()).join("\n");

async function pool<T>(items: T[], n: number, run: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { for (let t = queue.shift(); t !== undefined; t = queue.shift()) await run(t); }));
}

const all = specs();
if (flags.has("--lineup")) {
  const biomes = picked.length ? picked : [...new Set(all.map((s) => s.biome))];
  await pool(biomes, jobs, async (b) => {
    const mine = all.filter((s) => s.biome === b);
    if (!mine.length) { console.error(`no specs grow in ${b}`); return; }
    console.log(`${b}\n${report(await blender(["--lineup", b, ...mine.map((s) => join(DIR, `${s.id}.json`))]))}`);
  });
  process.exit(0);
}
const chosen = all.filter((s) => picked.length === 0 || picked.includes(s.id));
const unknown = picked.filter((id) => !all.some((s) => s.id === id));
if (unknown.length) { console.error(`no spec for ${unknown.join(", ")} in flora/`); process.exit(1); }

const argsFor = (id: string) => [join(DIR, `${id}.json`), ...(flags.has("--render") || flags.has("--watch") ? ["--render"] : []), ...(seed ? ["--seed", seed] : []), ...(variants ? ["--variants", variants] : [])];
let failed = 0;
await pool(chosen, jobs, async (s) => {
  try { console.log(`${s.id}\n${report(await blender(argsFor(s.id)))}`); } catch (e) { failed++; console.error(String(e)); }
});
if (flags.has("--watch")) {
  if (chosen.length !== 1) { console.error("--watch takes one plant id"); process.exit(1); }
  const id = chosen[0]!.id;
  console.log(`watching flora/${id}.json`);
  let busy = false;
  watch(join(DIR, `${id}.json`), async () => {
    if (busy) return;
    busy = true;
    try { console.log(report(await blender(argsFor(id)))); } catch (e) { console.error(String(e)); }
    busy = false;
  });
} else if (failed) process.exit(1);
