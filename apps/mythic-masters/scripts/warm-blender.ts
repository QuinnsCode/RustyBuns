// A warm Blender against a cold one, for one beast: `bun scripts/warm-blender.ts [id] [--runs 3]`. Builds the beast
// cold (`runBlender`, a fresh Blender, as `bun run beasts` does), then warm (one `warmBlender`, built `--runs` times),
// checks every GLB is byte for byte the cold one, and prints the times and the warm Blender's memory: idle, after the
// builds, and the most it held during a render. Run it on the builder (`bun run builder run apps/mythic-masters bun
// scripts/warm-blender.ts squonk`): its numbers are the ones in docs/BLENDER-TOOLS.md. It rewrites
// public/models/<id>.glb with whatever this Mac's Blender writes, so on a Blender other than 5.2.0, `git checkout` it after.
import { join } from "node:path";
import { runBlender, warmBlender } from "@rustybuns/cli/blender";
import { arr, num, obj, str } from "@rustybuns/util/guard";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);
const APP = join(import.meta.dir, "..");
const argv = process.argv.slice(2);
const at = argv.indexOf("--runs");
const runs = at < 0 ? 3 : Number(argv[at + 1]);
const id = argv.find((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1)) ?? "squonk";
const sheet = `beasts/${id}.json`, glb = join(APP, "public", "models", `${id}.glb`);
const THREADS = 8; // as beasts.ts: the thread count changes the decimated mesh

const hash = async () => new Bun.CryptoHasher("sha256").update(await Bun.file(glb).bytes()).digest("hex");
// What the process holds now, in MB (ps reads the Blender this Mac runs; ru_maxrss in `ping` is only the peak).
const rss = async (pid: number) => Math.round(Number(await new Response(Bun.spawn(["ps", "-o", "rss=", "-p", String(pid)]).stdout).text()) / 1024);
const secs = (t0: number) => ((performance.now() - t0) / 1000).toFixed(2);

let t0 = performance.now();
await runBlender({ script: "blender/beast.py", args: [sheet], cwd: APP, threads: THREADS });
const cold = { s: secs(t0), sha: await hash() };
console.log(`cold  ${id}: ${cold.s} s  ${cold.sha.slice(0, 12)}`);

t0 = performance.now();
await using b = await warmBlender({ cwd: APP, threads: THREADS });
console.log(`warm  start: ${secs(t0)} s, Blender ${b.info.blender}, idle ${await rss(b.info.pid)} MB`);
let same = true;
for (let i = 1; i <= runs; i++) {
  t0 = performance.now();
  await b.call("build", { script: "blender/beast.py", args: [sheet] });
  const sha = await hash();
  same &&= sha === cold.sha;
  console.log(`warm  ${id} #${i}: ${secs(t0)} s  ${sha.slice(0, 12)} ${sha === cold.sha ? "same as cold" : "DIFFERS from cold"}`);
}
console.log(`after builds: ${await rss(b.info.pid)} MB`);

await b.call("load", { glb: `public/models/${id}.glb` });
const Stats = arr(obj({ mesh: str(), triangles: num(0, 1e7), materials: arr(obj({ material: str(), triangles: num(0, 1e7) }), 100) }), 100);
for (const m of Stats(await b.call("stats"))) console.log(`stats ${m.mesh}: ${m.triangles} tris, ${m.materials.map((x) => `${x.material} ${x.triangles}`).join(", ")}`);
let peak = 0;
const sample = setInterval(async () => { peak = Math.max(peak, await rss(b.info.pid)); }, 50);
t0 = performance.now();
await b.call("render", { view: "three-quarter", size: 1024 });
clearInterval(sample);
const { peak_mb } = obj({ peak_mb: num(0, 1e6) })(await b.call("ping"));
console.log(`render 1024 px: ${secs(t0)} s, ${Math.max(peak, await rss(b.info.pid))} MB sampled during it, ${peak_mb} MB peak over the session`);
console.log(same ? "every warm GLB is byte for byte the cold one" : "a warm GLB differs from the cold one");
process.exitCode = same ? 0 : 1;
