// Writes every region's ground, read from the public Terrarium elevation tiles at the real place in
// src/world/places.ts: public/ground/<n>.bin (GROUND_N × GROUND_N Int16 metres above sea level over a `km`-wide
// square around its centre, fetched when you walk near) and src/world/coarse.json (every 4th sample of all of
// them, bundled, so the far land still draws). src/world/world.ts stitches them into the supercontinent.
//
//   bun scripts/fetch-world.ts          # every region (a few hundred tiles, under a minute)
//   bun scripts/fetch-world.ts 3 14     # just these, keeping the rest
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { elevation } from "../../../packages/terrain/scripts/terrarium.ts";
import { REGIONS } from "../src/regions.ts";
import { PLACES } from "../src/world/places.ts";
import { coarseOf, COARSE_N, GROUND_N, groundFrom, SEA_FLOOR } from "../src/world/world.ts";

const DIR = join(import.meta.dir, "../public/ground"), COARSE = join(import.meta.dir, "../src/world/coarse.json");
const KM_PER_DEG = 111.32;

async function fetchRegion(lat: number, lon: number, km: number): Promise<Int16Array> {
  // Pixels a few km across are plenty for a grid this coarse, and keep the tile count down.
  const zoom = km > 700 ? 5 : km > 250 ? 6 : 7;
  const heights = new Int16Array(GROUND_N * GROUND_N);
  for (let row = 0; row < GROUND_N; row++) {
    // Row 0 is the north edge, as rows run south on the world grid.
    const la = lat + (0.5 - row / (GROUND_N - 1)) * (km / KM_PER_DEG);
    const row_ = await Promise.all(Array.from({ length: GROUND_N }, (_, c) => {
      const lo = lon + (c / (GROUND_N - 1) - 0.5) * (km / (KM_PER_DEG * Math.cos((la * Math.PI) / 180)));
      return elevation(lo, la, zoom);
    }));
    row_.forEach((m, c) => { heights[row * GROUND_N + c] = Math.max(SEA_FLOOR, Math.round(m)); });
  }
  return heights;
}

const only = process.argv.slice(2).map(Number);
mkdirSync(DIR, { recursive: true });
/** Rewrites coarse.json from the files on disk. */
function writeCoarse() {
  const regions: Record<number, string> = {};
  for (const g of REGIONS) {
    const file = join(DIR, `${g.n}.bin`), fine = existsSync(file) ? groundFrom(readFileSync(file)) : undefined;
    if (fine) regions[g.n] = Buffer.from(coarseOf(fine).buffer).toString("base64");
  }
  writeFileSync(COARSE, JSON.stringify({ n: COARSE_N, regions }));
}
for (const g of REGIONS) {
  if (only.length && !only.includes(g.n)) continue;
  const t0 = Date.now();
  const at = PLACES[g.n];
  if (!at) continue;
  const heights = await fetchRegion(at.at[0], at.at[1], at.km);
  writeFileSync(join(DIR, `${g.n}.bin`), new Uint8Array(heights.buffer));
  writeCoarse(); // after each, so a dropped connection keeps the rest
  console.log(`${g.n} ${g.name}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
