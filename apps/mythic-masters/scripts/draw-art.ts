// Renders our own drawings (art-src/<id>.svg, drawn from each legend's description where no open picture
// exists) to public/art/<id>-bw.jpg, 480 px, and lists them in src/art.json as CC0 by the project.
// `bun scripts/draw-art.ts` after editing an SVG. fetch-art.ts leaves these entries alone.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { Art } from "../src/art.ts";

const ROOT = join(import.meta.dir, ".."), SRC = join(ROOT, "art-src"), JSON_PATH = join(ROOT, "src/art.json");
const art: Art = existsSync(JSON_PATH) ? Art(await Bun.file(JSON_PATH).json()) : {};
for (const file of readdirSync(SRC).filter((f) => f.endsWith(".svg")).sort()) {
  const id = file.slice(0, -4);
  const png = await $`rsvg-convert -w 480 ${join(SRC, file)}`.arrayBuffer();
  await Bun.write(join(ROOT, `public/art/${id}-bw.jpg`), await new Response(
    Bun.spawn(["ffmpeg", "-loglevel", "error", "-y", "-i", "-", "-frames:v", "1", "-q:v", "4", "-f", "mjpeg", "-"], { stdin: new Uint8Array(png) }).stdout).arrayBuffer());
  art[id] = { ...art[id], bw: {
    src: `art/${id}-bw.jpg`, page: `https://github.com/QuinnsCode/RustyBuns/blob/main/apps/mythic-masters/art-src/${file}`,
    artist: "Mythic Masters, drawn from the legend", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  } };
  console.log(`${id}: drawn`);
}
await Bun.write(JSON_PATH, JSON.stringify(art, null, 2) + "\n");
