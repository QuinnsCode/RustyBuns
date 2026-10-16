// Builds packages/terrain/src/zones/<id>.json: the real terrain around one attraction, for
// the 3D hunt. Committed, so the game never downloads anything.
//
//   bun scripts/fetch-zones.ts              every zone in ZONES not on disk yet
//   bun scripts/fetch-zones.ts half-dome    just these (refetches)
//
// Elevation: the public AWS "Terrain Tiles" open dataset (Terrarium PNGs), built
// from USGS 3DEP and other public sources. Landmarks inside the zone come from
// the park data in src/parks/data (OpenStreetMap).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { elevation } from "../../../packages/terrain/scripts/terrarium.ts";
import { project } from "../src/geo.ts";
import type { Landmark, ParkData } from "../src/parks/types.ts";
import type { ZoneData } from "../src/zones/types.ts";

interface ZoneSpec { id: string; park: string; name: string; blurb: string; lat: number; lon: number; trees: ZoneData["trees"] }

const ZONES: ZoneSpec[] = [
  { id: "half-dome", park: "yose", name: "Half Dome", blurb: "Granite dome, sheer north face, pines on the shoulders", lat: 37.7459, lon: -119.5332, trees: "pine" },
  { id: "el-capitan", park: "yose", name: "El Capitan", blurb: "The big wall and the meadow at its foot", lat: 37.729, lon: -119.637, trees: "pine" },
  { id: "yosemite-falls", park: "yose", name: "Yosemite Falls", blurb: "The valley floor under the tallest falls in the park", lat: 37.749, lon: -119.5966, trees: "pine" },
  { id: "glacier-point", park: "yose", name: "Glacier Point", blurb: "The rim, 1,000 m above the valley", lat: 37.7306, lon: -119.5738, trees: "pine" },
  { id: "mariposa-grove", park: "yose", name: "Mariposa Grove", blurb: "Giant sequoias, some 3,000 years old", lat: 37.511, lon: -119.601, trees: "sequoia" },
  { id: "old-faithful", park: "yell", name: "Old Faithful", blurb: "The Upper Geyser Basin: steaming vents, boardwalks, lodgepole pines", lat: 44.4625, lon: -110.8275, trees: "pine" },
  { id: "grand-prismatic", park: "yell", name: "Grand Prismatic", blurb: "Midway Geyser Basin, the rainbow spring and the Firehole River", lat: 44.5251, lon: -110.8382, trees: "pine" },
];

/** Half-width of a zone on the ground, in real metres. */
const REAL_RADIUS = 1000;
/** Height samples across the zone. */
const N = 161;
const OUT = join(import.meta.dir, "../../../packages/terrain/src/zones");

/** Named things on the ground within the zone: the signposts of the 3D map. */
async function namedFeatures(z: ZoneSpec): Promise<{ name: string; kind: Landmark["kind"]; lat: number; lon: number; ele?: number }[]> {
  const around = `(around:${REAL_RADIUS * 0.95},${z.lat},${z.lon})`;
  const q = `[out:json][timeout:60];(
    node["name"]["natural"~"^(peak|waterfall|tree|rock|cliff|saddle|spring|hot_spring|geyser|cave_entrance|arch)$"]${around};
    node["name"]["waterway"="waterfall"]${around};
    node["name"]["tourism"~"^(viewpoint|attraction|picnic_site|camp_site)$"]${around};
    node["name"]["historic"]${around};
  );out;`;
  for (let i = 0; i < 5; i++) {
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }), headers: { "user-agent": "rustybuns-park-hide-seek/0.1" } });
    if (r.ok) {
      const j = await r.json() as { elements: { lat: number; lon: number; tags: Record<string, string> }[] };
      // USGS "unnamed geyser" codes (UNNG-MGB-9) make poor signposts.
      return j.elements.filter((e) => !/^UNNG/.test(e.tags.name)).map((e) => {
        const t = e.tags;
        const kind: Landmark["kind"] = t.natural === "peak" ? "peak" : t.natural === "geyser" ? "geyser" : t.natural === "waterfall" || t.waterway === "waterfall" ? "falls"
          : t.natural === "spring" || t.natural === "hot_spring" ? "spring" : t.natural === "arch" ? "arch" : t.natural === "cave_entrance" ? "cave" : "view";
        const ele = Number.parseFloat(t.ele ?? "");
        return { name: t.name, kind, lat: e.lat, lon: e.lon, ...(ele ? { ele: Math.round(ele) } : {}) };
      });
    }
    console.log(`  overpass ${r.status}, retrying`);
    await Bun.sleep(8000 * (i + 1));
  }
  console.log("  ! no named features (Overpass busy)");
  return [];
}

async function build(z: ZoneSpec): Promise<ZoneData> {
  const park = (await Bun.file(join(import.meta.dir, `../src/parks/data/${z.park}.json`)).json()) as ParkData;
  const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos((z.lat * Math.PI) / 180);
  const heights = new Int16Array(N * N);
  // Row 0 is the south edge (y grows north), matching the 2D map's convention.
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const ex = -REAL_RADIUS + (2 * REAL_RADIUS * c) / (N - 1), ny = -REAL_RADIUS + (2 * REAL_RADIUS * r) / (N - 1);
      heights[r * N + c] = Math.round(await elevation(z.lon + ex / mPerDegLon, z.lat + ny / mPerDegLat));
    }
  }
  // Park landmarks inside the zone, moved into zone metres (x east, y north from the centre).
  const [px, py] = project(z.lon, z.lat, park.center[0], park.center[1]);
  const fromPark = [...park.landmarks, park.start]
    .map((m) => ({ ...m, x: Math.round((m.x - px) * 1000), y: Math.round((m.y - py) * 1000) }))
    .filter((m) => Math.hypot(m.x, m.y) < REAL_RADIUS * 0.95);
  const near = (await namedFeatures(z)).map(({ lat, lon, ...m }) => ({ ...m, x: Math.round((lon - z.lon) * mPerDegLon), y: Math.round((lat - z.lat) * mPerDegLat) }));
  // The park's start is often a landmark in its own right (Old Faithful): keep what it is.
  for (const m of fromPark) if (m.kind === "start") m.kind = near.find((f) => f.name === m.name)?.kind ?? m.kind;
  // Dedupe by name, park data first; keep it to signposts a player can learn.
  const seen = new Set<string>();
  const landmarks = [...fromPark, ...near].filter((m) => !seen.has(m.name) && seen.add(m.name)).slice(0, 24);
  let lo = Infinity, hi = -Infinity;
  for (const h of heights) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
  console.log(`${z.id}: ${lo}-${hi} m, ${landmarks.length} landmarks (${landmarks.map((m) => m.name).join(", ")})`);
  return {
    id: z.id, park: z.park.toUpperCase(), name: z.name, blurb: z.blurb, trees: z.trees,
    center: [z.lon, z.lat], parkXY: [Math.round(px * 1000) / 1000, Math.round(py * 1000) / 1000],
    realRadius: REAL_RADIUS, n: N,
    heights: Buffer.from(heights.buffer).toString("base64"),
    landmarks,
  };
}

const want = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
for (const z of ZONES) {
  const file = join(OUT, `${z.id}.json`);
  if (want.length ? !want.includes(z.id) : existsSync(file)) continue;
  writeFileSync(file, JSON.stringify(await build(z)));
}
