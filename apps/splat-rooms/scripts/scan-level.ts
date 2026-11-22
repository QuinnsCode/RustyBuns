// Spike for #3269: is a scanned room a level? Takes one scene folder (3dgs_compressed.ply + labels.json, and
// structure.json if there is one), cuts every huntable object out as its own PLY, checks the round planner, then
// does it again with the boxes made rough on purpose, the way a vision model's guesses might be.
//
//   bun scripts/scan-level.ts 0001_839920                 # report only
//   bun scripts/scan-level.ts 0001_839920 --out ./cut     # also write objects/<label>_<id>.ply there
//   bun scripts/scan-level.ts 0001_839920 --no-structure  # as if the scan came with no walls (phone capture)
//
// No model is called: the rough boxes are made here, so this costs nothing to run.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mulberry32 } from "@rustybuns/util";
import { readPly } from "../../splat-spray/src/levels/ply.ts";
import type { SceneDetail, SceneObject } from "../src/actions/scenes.ts";
import { candidates } from "../src/game/round.ts";
import { cutObjects, iou, roughen, roundCheck, toRows, type Rough } from "../rooms/extract.ts";
import { packPly } from "../rooms/pack.ts";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const DIR = (process.env.SPLAT_ROOMS_DIR ?? "~/Documents/SplatRooms").replace(/^~/, homedir());
if (!id) { console.error("usage: bun scripts/scan-level.ts <scene> [--out dir] [--no-structure]"); process.exit(1); }
const folder = join(DIR, id);
const plyPath = join(folder, "3dgs_compressed.ply");
if (!existsSync(plyPath)) { console.error(`${plyPath}: missing`); process.exit(1); }

const t0 = performance.now();
const raw = readPly(new Uint8Array(readFileSync(plyPath)));
if (!raw) { console.error(`${plyPath}: not a compressed PLY`); process.exit(1); }
const objects = JSON.parse(readFileSync(join(folder, "labels.json"), "utf8")) as SceneObject[];
const structPath = join(folder, "structure.json");
const structure = !args.includes("--no-structure") && existsSync(structPath)
  ? JSON.parse(readFileSync(structPath, "utf8")) as SceneDetail["structure"] : null;
const decodeMs = performance.now() - t0;

const truth = candidates(objects);
const t1 = performance.now();
const cuts = cutObjects(raw, truth);
const cutMs = performance.now() - t1;
const sizes = [...cuts.values()].map((c) => c.length).sort((a, b) => a - b);
const empty = sizes.filter((n) => n < 50).length;
const inObjects = sizes.reduce((s, n) => s + n, 0);

let written = 0, bytes = 0;
const out = flag("--out");
if (out) {
  mkdirSync(join(out, "objects"), { recursive: true });
  for (const c of truth) {
    const idx = cuts.get(c.ins_id)!;
    if (idx.length < 50) continue;
    const file = join(out, "objects", `${c.label.replace(/[^\w-]+/g, "_")}_${c.ins_id}.ply`);
    writeFileSync(file, packPly(toRows(raw, idx)));
    written++;
    bytes += statSync(file).size;
  }
}

const base = roundCheck({ objects, structure });
const LEVELS: [string, Rough][] = [
  ["close (5 cm, 10%, none missed)", { shift: 0.05, scale: 0.1, drop: 0 }],
  ["rough (15 cm, 25%, 10% missed)", { shift: 0.15, scale: 0.25, drop: 0.1 }],
  ["poor (30 cm, 40%, 25% missed)", { shift: 0.3, scale: 0.4, drop: 0.25 }],
];
const rough = LEVELS.map(([name, r]) => {
  const guessed = roughen(objects, r, mulberry32(7));
  const g = candidates(guessed);
  const gc = cutObjects(raw, g);
  const scores = g.map((c) => iou(cuts.get(c.ins_id) ?? [], gc.get(c.ins_id)!)).sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)] ?? 0;
  const bad = scores.filter((s) => s < 0.5).length;
  return { name, objects: g.length, medianIou: +median.toFixed(2), under50: bad, rounds: roundCheck({ objects: guessed, structure }) };
});

console.log(JSON.stringify({
  scene: id,
  splats: raw.count,
  plyMb: +(statSync(plyPath).size / 1e6).toFixed(1),
  labels: objects.length,
  huntable: truth.length,
  structure: !!structure,
  decodeMs: Math.round(decodeMs),
  cutMs: Math.round(cutMs),
  cut: { inObjects, share: +(inObjects / raw.count).toFixed(3), medianSplats: sizes[Math.floor(sizes.length / 2)] ?? 0, under50: empty },
  written: out ? { files: written, mb: +(bytes / 1e6).toFixed(1) } : undefined,
  rounds: base,
  rough,
}, null, 2));
