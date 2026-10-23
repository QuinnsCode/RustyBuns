// Writes packages/terrain/src/zones/<id>.json for any place on Earth: a 2 km square of real ground from the
// public elevation tiles. No park data needed, so this is how Skate Tech Park gets a new location.
//
//   bun packages/terrain/scripts/fetch-place.ts grand-canyon "Grand Canyon" 36.0614 -112.1077 "South Rim at Mather Point"
//   bun packages/terrain/scripts/fetch-place.ts dry-tortugas "Dry Tortugas" 24.628 -82.873 "Fort Jefferson" --water 0
//
// The tiles carry the sea and lake floors too, so a coast or a shore comes back as a cliff into the deep: `water`
// (metres above sea level) flattens everything below that height to it, and the water is a floor you can ride.
//
// then write a level (apps/skate-tech-park/src/levels); the zone is loaded on demand by `loadZone`, nothing to register.
// apps/skate-tech-park/scripts/fetch-parks.ts calls `fetchPlace` for every row of its park table.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { elevation } from "./terrarium.ts";

const REAL_RADIUS = 1000, N = 161;

export async function fetchPlace(id: string, name: string, lat: number, lon: number, blurb = "", water?: number) {
  const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const t0 = Date.now(), heights = new Int16Array(N * N);
  // Row 0 is the south edge, as in the other zones.
  for (let r = 0; r < N; r++) {
    const ny = -REAL_RADIUS + (2 * REAL_RADIUS * r) / (N - 1);
    for (let c = 0; c < N; c++) {
      const ex = -REAL_RADIUS + (2 * REAL_RADIUS * c) / (N - 1);
      const m = Math.round(await elevation(lon + ex / mPerDegLon, lat + ny / mPerDegLat));
      heights[r * N + c] = water !== undefined && m < water ? water : m;
    }
  }
  const lo = Math.min(...heights), hi = Math.max(...heights);
  writeFileSync(join(import.meta.dir, `../src/zones/${id}.json`), JSON.stringify({
    id, park: "", name, blurb, trees: "pine", center: [lon, lat], parkXY: [0, 0], realRadius: REAL_RADIUS, n: N,
    heights: Buffer.from(heights.buffer).toString("base64"), landmarks: [],
  }));
  console.log(`${id}: ${lo}-${hi} m (${hi - lo} m of relief) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (import.meta.main) {
  const w = process.argv.indexOf("--water"), water = w > 0 ? Number(process.argv[w + 1]) : undefined;
  const [id, name, latArg, lonArg, blurb] = process.argv.slice(2).filter((a, i, all) => a !== "--water" && all[i - 1] !== "--water");
  const lat = Number(latArg), lon = Number(lonArg);
  if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("usage: fetch-place.ts <id> <name> <lat> <lon> [blurb] [--water <m>]");
  await fetchPlace(id, name, lat, lon, blurb, water);
}
