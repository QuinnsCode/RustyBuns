// Build the beasts: `bun scripts/beasts.ts [--render] [--rig-only] [--jobs N] [id ...]`. Each sheet in beasts/ goes
// through Blender (blender/beast.py: the mesh, public/models/<id>.glb, and with --render a contact sheet in
// blender/out/<id>.png to look at), then through auto-rig's voxel rigger, which finds its skeleton and skin
// weights and writes public/models/<id>.rig.json with the feet marked. Prints one row per beast; a beast
// whose feet count doesn't match its sheet is a bug in the sheet (a leg merged into the body, or a tail
// that touches the ground) and the row says so, as it does when an even count doesn't split half on each side
// ("one-sided": a low tail or talon tip standing in for a lost foot); so is a wing count off from the sheet's `wings`, when it has one.
//
// The model loop, with no hand-driven Chrome:
//   --watch <id>          rebuild on every save of beasts/<id>.json in one warm Blender (no cold start after the first);
//                         a running `vite` dev server swaps that beast in the ?gallery page without a reload
//   --serve               one beast id a line on stdin, built in one warm Blender, one `@@built {id, ok, log}` line each;
//                         stdin closing ends it (the dev server's `beast_nudge` keeps one open: dev-beasts.ts)
//   --silhouette <id>     blender/out/<id>.silhouette.png: the contact sheet in flat black on white
//   --close               blender/out/<id>.close.png: the GLB's own mesh up close, to judge a baked `hide`
//   --swatch [pattern ...] [--sample <id>]   blender/out/hides.png: every hide pattern (or those) baked on a sphere and on
//                         a sample beast (the Tatzelwurm), from the examples in blender/hides.py (docs/HIDES.md)
//   --shots [page] [--as before|now]   each ?gallery page (or one) as a 4 x 4 sheet of close-ups, held still, in blender/out/shots/<label>/
//   --judge               shoots NOW, shows BEFORE and NOW to a fresh `claude -p` judge, writes its score table to
//                         blender/out/judge.md for the PR body (take BEFORE first: --shots --as before)
//
// Blenders run --jobs at a time (default: one per core). All 76 at once took about 350 MB each, more than a
// 16 GB Mac has. Each runs on 8 threads and on Blender 5.2.0 only (BLENDER_THREADS, BLENDER_VERSION below), so any
// Mac writes the committed GLBs byte for byte; another Blender stops with what to install.
import { readdirSync, watch } from "node:fs";
import { runBlender, warmBlender, type WarmBlender } from "@rustybuns/cli/blender";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { int, num, obj, opt } from "@rustybuns/util/guard";
import { analyze, rigToWire } from "@rustybuns/rig";
import { loadGlb } from "@rustybuns/rig/model";
import { feetOf, feetPaired, wingsOf, type BeastRig } from "../src/beasts.ts";
import { SHEET_WHO } from "../src/roster.ts";
import { judge, OUT, shoot } from "./beast-loop.ts";
import { help } from "../../../scripts/help.ts";
import { queued } from "../../../scripts/blender-queue.ts";

await queued(); // Blender runs on the builder Mac, one job at a time (scripts/blender-queue.ts)
const APP = join(import.meta.dir, "..");
const Sheet = obj({ ...SHEET_WHO, feet: int(0, 8), wings: opt(int(0, 8)), budget: num(100, 20000, 3000) });

help(import.meta.path);
const argv = process.argv.slice(2);
const jobsAt = argv.indexOf("--jobs");
const jobs = jobsAt < 0 ? availableParallelism() : Number(argv[jobsAt + 1]);
if (!(Number.isInteger(jobs) && jobs >= 1)) { console.error("--jobs takes a whole number of Blenders to run at once"); process.exit(1); }
const asAt = argv.indexOf("--as");
const label = asAt >= 0 ? argv[asAt + 1] : "now";
if (asAt >= 0 && label !== "before" && label !== "now") { console.error("--as takes before or now"); process.exit(1); }
const rest = argv.filter((_, i) => (asAt < 0 || (i !== asAt && i !== asAt + 1)) && (jobsAt < 0 || (i !== jobsAt && i !== jobsAt + 1)));
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const picked = rest.filter((a) => !a.startsWith("--"));

if (flags.has("--judge")) {
  console.log(await judge());
  console.log(`\nwritten to ${join(OUT, "judge.md")}`);
  process.exit(0);
}
if (flags.has("--shots")) {
  const page = picked[0] === undefined ? undefined : Number(picked[0]);
  if (page !== undefined && !(Number.isInteger(page) && page >= 0)) { console.error("--shots takes a page number"); process.exit(1); }
  for (const f of await shoot(label!, page === undefined ? undefined : [page])) console.log(f);
  process.exit(0);
}
// Blender's thread count changes the decimated mesh, so it is pinned (8 is what the committed GLBs were built with)
// and a Mac with another core count makes the same GLBs. Running several Blenders at once is safe: each uses 8 threads' worth of work.
// The version is pinned too: 5.2.1 writes other GLBs from the same sheets (#4129). Moving it means rebuilding every beast.
const BLENDER_THREADS = 8, BLENDER_VERSION = "5.2.0";
if (flags.has("--swatch")) {
  const at = rest.indexOf("--sample"), sample = at >= 0 ? rest[at + 1]! : null;
  const pats = picked.filter((p) => p !== sample);
  const { out } = await runBlender({ script: "blender/hides.py", args: [...(sample ? ["--sample", sample] : []), ...pats], cwd: APP, threads: BLENDER_THREADS });
  for (const l of out.split("\n").filter((l) => /^hide:|render ->/.test(l))) console.log(l);
  process.exit(0);
}
if (flags.has("--silhouette") && picked.length !== 1) { console.error("--silhouette takes one beast id"); process.exit(1); }
// A sheet's path by id: every one in beasts/, and a pack's (packs/<id>/beasts/) only when named, since a pack's beasts
// are built when they join the roster.
const sheetsIn = (dir: string) => readdirSync(join(APP, dir)).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), `${dir}/${f}`] as const);
const SHEETS = new Map([...readdirSync(join(APP, "packs")).flatMap((p) => sheetsIn(`packs/${p}/beasts`)), ...sheetsIn("beasts")]);
const packSheet = (id: string) => !SHEETS.get(id)!.startsWith("beasts/");
const ids = [...SHEETS.keys()].filter((id) => picked.length === 0 ? !packSheet(id) : picked.includes(id));
if (ids.length === 0) { console.error("no beast sheets matched"); process.exit(1); }

// The decimator is chaotic and the snap step in beast.py picks which valid decimation a beast gets, so a step can
// land a beast on a rig that is wrong (a foot lost, a leg split in two). The same fixed list is tried in order and
// the first step whose rig matches the sheet is kept, so a build is still the same every run.
const SNAP_STEPS = ["1e-3", "5e-4", "2e-3", "2.5e-4", "4e-3", "1e-4"];


// --watch and --serve build in one warm Blender (#3822): a warm build is byte for byte a cold one
// (test/warm-blender.test.ts) and skips Blender's start. A failed build closes it, so the next starts clean.
const WARM = flags.has("--watch") || flags.has("--serve");
let warm: Promise<WarmBlender> | null = null, said: string[] = [];
const NOTE = /triangles|render ->|^hide:/;

async function blender(id: string, step: string): Promise<string[]> {
  const args = [SHEETS.get(id)!, ...(flags.has("--render") ? ["--render"] : []), ...(flags.has("--silhouette") ? ["--silhouette"] : []), ...(flags.has("--close") ? ["--close"] : [])];
  if (!WARM) {
    const { out, err } = await runBlender({ script: "blender/beast.py", args, cwd: APP, env: { SNAP_STEP: step }, threads: BLENDER_THREADS, version: BLENDER_VERSION });
    return (out + err).split("\n").filter((l) => NOTE.test(l));
  }
  warm ??= warmBlender({ cwd: APP, threads: BLENDER_THREADS, version: BLENDER_VERSION, onLog: (l) => { said.push(l); } });
  const b = await warm.catch((e: unknown) => { warm = null; throw e; });
  said = [];
  try {
    await b.call("build", { script: "blender/beast.py", args, env: { SNAP_STEP: step } });
  } catch (e) {
    await closeWarm();
    throw e;
  }
  return said.filter((l) => NOTE.test(l));
}
async function closeWarm() {
  const w = warm;
  warm = null;
  await (await w?.catch(() => null))?.close();
}

async function rig(id: string, feet: number, expectWings?: number) {
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
  const wings = wingsOf(r, tips.filter((t) => !found.includes(t)), height, extent, expectWings);
  // timings are wall-clock: zeroed in the file, so a rebuild of an unchanged beast is byte for byte the same
  const sidecar: BeastRig = { ...rigToWire(r), timings: { voxelize: 0, distance: 0, skeleton: 0, weights: 0 }, tips, feet: found, wings, height: +height.toFixed(4), extent: +extent.toFixed(4) };
  await Bun.write(join(APP, "public", "models", `${id}.rig.json`), JSON.stringify(sidecar));
  const paired = feetPaired(r, found, extent);
  return { joints: r.parents.length, tips: tips.length, feet: found.length, paired, wings: wings.length, ms, ok: found.length === feet && paired && (expectWings === undefined || wings.length === expectWings), tris: model.triangles };
}

async function build(id: string): Promise<Built> {
  const sheet = Sheet(await Bun.file(join(APP, SHEETS.get(id)!)).json());
  if (flags.has("--rig-only")) return { id, sheet, notes: [], r: await rig(id, sheet.feet, sheet.wings) };
  let built: Built | undefined;
  for (const step of SNAP_STEPS) {
    const notes = await blender(id, step);
    const r = await rig(id, sheet.feet, sheet.wings);
    built = { id, sheet, notes: step === SNAP_STEPS[0] ? notes : [...notes, `snap step ${step} m, the first that rigs`], r };
    if (r.ok) break;
  }
  return built!;
}
type Built = { id: string; sheet: ReturnType<typeof Sheet>; notes: string[]; r: Awaited<ReturnType<typeof rig>> };
const report = (b: Built) => console.log(row(b));
function row({ id, sheet, notes, r }: Built) {
  return [...notes.map((n) => `  ${n}`), `${r.ok ? "ok " : "!! "}${id.padEnd(14)} ${sheet.archetype.padEnd(10)} ${String(r.tris).padStart(5)} tris  ${String(r.joints).padStart(3)} joints  ${String(r.tips).padStart(2)} tips  feet ${r.feet}/${sheet.feet}${r.paired ? "" : " one-sided"}  wings ${r.wings}${sheet.wings === undefined ? "" : `/${sheet.wings}`}  rigged in ${r.ms.toFixed(0)} ms`].join("\n");
}

if (flags.has("--watch")) {
  if (picked.length !== 1) { console.error("--watch takes one beast id"); process.exit(1); }
  const id = picked[0]!, sheetPath = join(APP, SHEETS.get(id) ?? `beasts/${id}.json`);
  const rebuild = async () => { try { report(await build(id)); } catch (e) { console.error(e instanceof Error ? e.message : e); } };
  await rebuild();
  console.log(`watching beasts/${id}.json: a save rebuilds it, and a running dev server (bun run dev) swaps it into ?gallery`);
  let timer: ReturnType<typeof setTimeout> | undefined, running = false, again = false;
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) { again = true; return; }
      running = true;
      do { again = false; await rebuild(); } while (again);
      running = false;
    }, 150);
  };
  watch(sheetPath, kick);
  await new Promise(() => {});
}

if (flags.has("--serve")) {
  const lines = console.log;
  console.log = console.error; // stdout is the reply lines only
  const reader = Bun.stdin.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    buf += r.value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const id = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!id) continue;
      let reply: { id: string; ok: boolean; log: string };
      if (!SHEETS.has(id)) reply = { id, ok: false, log: `no sheet for ${id}` };
      else try { reply = { id, ok: true, log: row(await build(id)) }; } catch (e) { reply = { id, ok: false, log: e instanceof Error ? e.message : String(e) }; }
      lines(`@@built ${JSON.stringify(reply)}`);
    }
  }
  await closeWarm();
  process.exit(0);
}

// Each slot takes the next id until none are left; rows keep the sheet order.
const rows = new Array<Built>(ids.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobs, ids.length) }, async () => {
  while (next < ids.length) { const i = next++; rows[i] = await build(ids[i]!); }
}));
rows.forEach(report);
if (flags.has("--silhouette")) for (const id of ids) console.log(`  silhouette -> ${join(OUT, `${id}.silhouette.png`)}`);
if (rows.some((x) => !x.r.ok)) { console.error("a beast's feet or wings don't match its sheet"); process.exit(1); }
