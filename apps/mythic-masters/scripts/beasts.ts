// Build the beasts: `bun scripts/beasts.ts [--render] [--rig-only] [id ...]`. Each sheet in beasts/ goes
// through Blender (blender/beast.py: the mesh, public/models/<id>.glb, and with --render a contact sheet in
// blender/out/<id>.png to look at), then through auto-rig's voxel rigger, which finds its skeleton and skin
// weights and writes public/models/<id>.rig.json with the feet marked. Prints one row per beast; a beast
// whose feet count doesn't match its sheet is a bug in the sheet (a leg merged into the body, or a tail
// that touches the ground) and the row says so; so is a wing count off from the sheet's `wings`, when it has one.
//
// The model loop, with no hand-driven Chrome:
//   --watch <id>          rebuild on every save of beasts/<id>.json; a running `vite` dev server swaps that beast in the
//                         ?gallery page without a reload
//   --silhouette <id>     blender/out/<id>.silhouette.png: the contact sheet in flat black on white
//   --shots [page] [--as before|now]   the 4 ?gallery pages (or one) as PNGs in blender/out/shots/<label>/ (default now)
//   --judge               shoots NOW, shows BEFORE and NOW to a fresh `claude -p` judge, writes its score table to
//                         blender/out/judge.md for the PR body (take BEFORE first: --shots --as before)
import { readdirSync, watch } from "node:fs";
import { join } from "node:path";
import { int, num, obj, oneOf, opt, str } from "@rustybuns/util/guard";
import { analyze, rigToWire } from "@rustybuns/rig";
import { loadGlb } from "@rustybuns/rig/model";
import { feetOf, wingsOf, type BeastRig } from "../src/beasts.ts";
import { ARCHETYPES } from "../src/roster.ts";
import { judge, OUT, shoot } from "./beast-loop.ts";

const APP = join(import.meta.dir, "..");
const Sheet = obj({ id: str(40, { re: /^[a-z0-9-]+$/ }), name: str(40), archetype: oneOf(ARCHETYPES), feet: int(0, 8), wings: opt(int(0, 8)), budget: num(100, 20000, 3000) });

const argv = process.argv.slice(2);
const asAt = argv.indexOf("--as");
const label = asAt >= 0 ? argv[asAt + 1] : "now";
if (asAt >= 0 && label !== "before" && label !== "now") { console.error("--as takes before or now"); process.exit(1); }
const rest = argv.filter((_, i) => asAt < 0 || (i !== asAt && i !== asAt + 1));
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
if (flags.has("--silhouette") && picked.length !== 1) { console.error("--silhouette takes one beast id"); process.exit(1); }
const ids = readdirSync(join(APP, "beasts")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => picked.length === 0 || picked.includes(id));
if (ids.length === 0) { console.error("no beast sheets matched"); process.exit(1); }

async function blender(id: string): Promise<string[]> {
  const args = ["blender", "-b", "--factory-startup", "--python-exit-code", "1", "-P", "blender/beast.py", "--", `beasts/${id}.json`, ...(flags.has("--render") ? ["--render"] : []), ...(flags.has("--silhouette") ? ["--silhouette"] : [])];
  const p = Bun.spawn(args, { cwd: APP, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text() + await new Response(p.stderr).text();
  if ((await p.exited) !== 0) throw new Error(`blender failed on ${id}:\n${out.split("\n").filter((l) => /Error|Traceback|line \d+/.test(l)).join("\n")}`);
  return out.split("\n").filter((l) => /triangles|render ->/.test(l));
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
  const sidecar: BeastRig = { ...rigToWire(r), tips, feet: found, wings, height: +height.toFixed(4), extent: +extent.toFixed(4) };
  await Bun.write(join(APP, "public", "models", `${id}.rig.json`), JSON.stringify(sidecar));
  return { joints: r.parents.length, tips: tips.length, feet: found.length, wings: wings.length, ms, ok: found.length === feet && (expectWings === undefined || wings.length === expectWings), tris: model.triangles };
}

async function build(id: string) {
  const sheet = Sheet(await Bun.file(join(APP, "beasts", `${id}.json`)).json());
  const notes = flags.has("--rig-only") ? [] : await blender(id);
  const r = await rig(id, sheet.feet, sheet.wings);
  return { id, sheet, notes, r };
}
type Built = Awaited<ReturnType<typeof build>>;
function report({ id, sheet, notes, r }: Built) {
  for (const n of notes) console.log(`  ${n}`);
  console.log(`${r.ok ? "ok " : "!! "}${id.padEnd(14)} ${sheet.archetype.padEnd(10)} ${String(r.tris).padStart(5)} tris  ${String(r.joints).padStart(3)} joints  ${String(r.tips).padStart(2)} tips  feet ${r.feet}/${sheet.feet}  wings ${r.wings}${sheet.wings === undefined ? "" : `/${sheet.wings}`}  rigged in ${r.ms.toFixed(0)} ms`);
}

if (flags.has("--watch")) {
  if (picked.length !== 1) { console.error("--watch takes one beast id"); process.exit(1); }
  const id = picked[0]!, sheetPath = join(APP, "beasts", `${id}.json`);
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

const rows = await Promise.all(ids.map(build));
rows.forEach(report);
if (flags.has("--silhouette")) for (const id of ids) console.log(`  silhouette -> ${join(OUT, `${id}.silhouette.png`)}`);
if (rows.some((x) => !x.r.ok)) { console.error("a beast's feet or wings don't match its sheet"); process.exit(1); }
