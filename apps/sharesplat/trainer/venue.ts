#!/usr/bin/env bun
// Photos of a place -> a Gaussian splat (#5994): COLMAP works out where each photo was taken from, Brush trains the splat.
//
//   bun trainer/venue.ts <photo-folder> [--out <folder>] [--steps 30000] [--max-splats 1500000]
//
// It writes <out>/splat.ply (out is <photo-folder>-splat unless given). It fetches nothing: the photos are ones already
// on disk, and you need the right to publish a model made from them. Then, in ShareSplat: open the .ply, do NOT press
// the scissors (they cut a product off its table, which would eat a room), press the cloud, and paste the link into the
// Qevent party's Venue. Needs `colmap` and `brush` on PATH (or COLMAP= / BRUSH=), and a GPU for Brush.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const PHOTO = new Set([".jpg", ".jpeg", ".png"]);
/** Fewer than this and COLMAP rarely places enough of them to show a room. */
const FEWEST = 20;
const NEEDS = {
  COLMAP: { bin: "colmap", get: "brew install colmap" },
  BRUSH: { bin: "brush", get: "download brush-app from https://github.com/ArthurBrussee/brush/releases (v0.3.0) and put `brush` on PATH" },
};

function tool(name: keyof typeof NEEDS): string {
  const { bin, get } = NEEDS[name];
  const found = Bun.which(process.env[name] || bin, { PATH: process.env.PATH ?? "" });
  if (!found) throw new Error(`no ${bin} here: ${get} (or set ${name}=/path/to/${bin})`);
  return found;
}

async function run(step: string, cmd: string[]): Promise<void> {
  console.log(`\n== ${step}`);
  const code = await Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" }).exited;
  if (code !== 0) throw new Error(`${step} failed (exit ${code})`);
}

function count(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${flag} takes a whole number, not "${value}"`);
  return n;
}

export async function train(argv: string[]): Promise<string> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { out: { type: "string" }, steps: { type: "string", default: "30000" }, "max-splats": { type: "string", default: "1500000" } },
  });
  const [from] = positionals;
  if (!from || !existsSync(from) || !statSync(from).isDirectory()) throw new Error("usage: bun trainer/venue.ts <photo-folder> [--out <folder>]");
  const steps = count(values.steps, "steps"), maxSplats = count(values["max-splats"], "max-splats");
  const photos = readdirSync(from).filter((f) => PHOTO.has(extname(f).toLowerCase()));
  if (photos.length < FEWEST) throw new Error(`${photos.length} .jpg/.png photos in ${basename(resolve(from))}: a place needs at least ${FEWEST}, overlapping (60 or more is better)`);
  // Both before any work, so a missing trainer isn't found after an hour of matching.
  const colmap = tool("COLMAP"), brush = tool("BRUSH");

  const out = resolve(values.out ?? `${resolve(from)}-splat`);
  const data = join(out, "dataset"), images = join(data, "images"), sparse = join(data, "sparse"), db = join(out, "colmap.db");
  // A second run starts clean: an old database would keep matches for photos since taken out.
  for (const old of [data, db, join(out, "splat.ply")]) rmSync(old, { recursive: true, force: true });
  mkdirSync(images, { recursive: true });
  mkdirSync(sparse, { recursive: true });
  for (const p of photos) copyFileSync(join(from, p), join(images, p));

  // No GPU for COLMAP: its GPU path is CUDA, which a Mac doesn't have.
  await run("find features", [colmap, "feature_extractor", "--database_path", db, "--image_path", images, "--FeatureExtraction.use_gpu", "0"]);
  await run("match photos", [colmap, "exhaustive_matcher", "--database_path", db, "--FeatureMatching.use_gpu", "0"]);
  await run("place cameras", [colmap, "mapper", "--database_path", db, "--image_path", images, "--output_path", sparse]);
  if (!existsSync(join(sparse, "0"))) throw new Error("COLMAP could not place the photos: they need to overlap, each part of the place seen from several spots");

  // sh-degree 0 and a splat cap keep the upload under ShareSplat's size limit.
  await run("train the splat", [
    brush, data, "--total-steps", String(steps), "--max-splats", String(maxSplats), "--sh-degree", "0",
    "--export-every", String(steps), "--export-path", out, "--export-name", "splat.ply",
  ]);
  const ply = join(out, "splat.ply");
  if (!existsSync(ply)) throw new Error("Brush finished without writing splat.ply");
  return ply;
}

if (import.meta.main) {
  try {
    const ply = await train(process.argv.slice(2));
    console.log(`\n${ply}\nOpen it in ShareSplat, skip the scissors, press the cloud, and paste the link into the party's Venue.`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
