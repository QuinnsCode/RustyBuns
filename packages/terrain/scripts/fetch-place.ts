// Writes packages/terrain/src/zones/<id>.json for any place on Earth: a 2 km square of real ground from the
// public elevation tiles. No park data needed, so this is how Skate Tech Park gets a new location.
//
//   bun packages/terrain/scripts/fetch-place.ts grand-canyon "Grand Canyon" 36.0614 -112.1077 "South Rim at Mather Point"
//
// then add the id to PLACES in src/zones.ts and write a level (apps/skate-tech-park/src/levels).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { elevation } from "./terrarium.ts";

const [id, name, latArg, lonArg, blurb = ""] = process.argv.slice(2);
const lat = Number(latArg), lon = Number(lonArg);
if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("usage: fetch-place.ts <id> <name> <lat> <lon> [blurb]");

const REAL_RADIUS = 1000, N = 161;
const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
const t0 = Date.now(), heights = new Int16Array(N * N);
// Row 0 is the south edge, as in the other zones.
for (let r = 0; r < N; r++) {
  const ny = -REAL_RADIUS + (2 * REAL_RADIUS * r) / (N - 1);
  for (let c = 0; c < N; c++) {
    const ex = -REAL_RADIUS + (2 * REAL_RADIUS * c) / (N - 1);
    heights[r * N + c] = Math.round(await elevation(lon + ex / mPerDegLon, lat + ny / mPerDegLat));
  }
}
const lo = Math.min(...heights), hi = Math.max(...heights);
writeFileSync(join(import.meta.dir, `../src/zones/${id}.json`), JSON.stringify({
  id, park: "", name, blurb, trees: "pine", center: [lon, lat], parkXY: [0, 0], realRadius: REAL_RADIUS, n: N,
  heights: Buffer.from(heights.buffer).toString("base64"), landmarks: [],
}));
console.log(`${id}: ${lo}-${hi} m (${hi - lo} m of relief) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
