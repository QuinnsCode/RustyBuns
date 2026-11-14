// Saves each beast's card pictures (src/art.ts PICKS, Commons file titles) to public/art/<id>-<side>.jpg, 480 px
// wide (ffmpeg on PATH re-encodes it, flattening a transparent PNG onto white), and writes who made each and under what licence to src/art.json, which the card reads.
// `bun scripts/fetch-art.ts` fetches only what's missing; `--all` fetches everything again.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Art, CREDIT, PICKS, type Pic } from "../src/art.ts";
import { fetchFile } from "./commons.ts";

const ROOT = join(import.meta.dir, ".."), OUT = join(ROOT, "public/art"), JSON_PATH = join(ROOT, "src/art.json");
const all = process.argv.includes("--all");

async function fetchPic(file: string, base: string): Promise<Pic> {
  const c = await fetchFile(file, join(OUT, `${base}.jpg`), { width: 480, artist: CREDIT[file] });
  return { ...c, src: `art/${base}.jpg` };
}

mkdirSync(OUT, { recursive: true });
const saved: Art = existsSync(JSON_PATH) && !all ? Art(await Bun.file(JSON_PATH).json()) : {};
// Keep only what is still picked: a side dropped from PICKS leaves art.json and its file goes.
const art: Art = {};
for (const [id, sides] of Object.entries(saved)) for (const side of ["bw", "color"] as const) {
  const pic = sides[side];
  if (!pic) continue;
  if (PICKS[id]?.[side] || pic.page.includes("/QuinnsCode/")) art[id] = { ...art[id], [side]: pic };
  else rmSync(join(ROOT, "public", pic.src), { force: true });
}
for (const [id, pick] of Object.entries(PICKS)) {
  for (const side of ["bw", "color"] as const) {
    const file = pick[side];
    if (!file || (art[id]?.[side] && existsSync(join(ROOT, "public", art[id][side].src)))) continue;
    const pic = await fetchPic(file, `${id}-${side}`);
    art[id] = { ...art[id], [side]: pic };
    console.log(`${id} ${side}: ${pic.license}, ${pic.artist}`);
  }
}
await Bun.write(JSON_PATH, JSON.stringify(art, null, 2) + "\n");
