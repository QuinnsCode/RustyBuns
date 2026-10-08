// Builds src/zones/data/<id>.json: the real terrain around one attraction, for
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
import { inflateSync } from "node:zlib";
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
];

/** Half-width of a zone on the ground, in real metres. */
const REAL_RADIUS = 1000;
/** Height samples across the zone. */
const N = 161;
const ZOOM = 14;
const TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const OUT = join(import.meta.dir, "../src/zones/data");

// ---- a minimal PNG reader: 8-bit RGB/RGBA, non-interlaced (what Terrarium serves)
function decodePng(buf: Uint8Array): { w: number; h: number; rgb: (x: number, y: number) => [number, number, number] } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8, w = 0, h = 0, ch = 3;
  const idat: Uint8Array[] = [];
  while (p < buf.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12);
      const depth = data[8], color = data[9], interlace = data[12];
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) throw new Error(`unsupported PNG (depth ${depth}, color ${color})`);
      ch = color === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, rgb: (x, y) => { const i = y * stride + x * ch; return [px[i], px[i + 1], px[i + 2]]; } };
}

// Web Mercator: lon/lat to global pixel coordinates at ZOOM.
const worldPx = (lon: number, lat: number): [number, number] => {
  const n = 256 * 2 ** ZOOM, s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

const tileCache = new Map<string, ReturnType<typeof decodePng>>();
async function tile(tx: number, ty: number) {
  const key = `${tx}/${ty}`;
  let t = tileCache.get(key);
  if (!t) {
    const r = await fetch(`${TILES}/${ZOOM}/${tx}/${ty}.png`);
    if (!r.ok) throw new Error(`tile ${key}: ${r.status}`);
    t = decodePng(new Uint8Array(await r.arrayBuffer()));
    tileCache.set(key, t);
  }
  return t;
}

async function elevation(lon: number, lat: number): Promise<number> {
  const [gx, gy] = worldPx(lon, lat);
  // Bilinear between the four nearest pixels.
  const x0 = Math.floor(gx - 0.5), y0 = Math.floor(gy - 0.5), fx = gx - 0.5 - x0, fy = gy - 0.5 - y0;
  const at = async (x: number, y: number) => {
    const t = await tile(Math.floor(x / 256), Math.floor(y / 256));
    const [r, g, b] = t.rgb(((x % 256) + 256) % 256, ((y % 256) + 256) % 256);
    return r * 256 + g + b / 256 - 32768;
  };
  const [a, b, c, d] = await Promise.all([at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)]);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/** Named things on the ground within the zone: the signposts of the 3D map. */
async function namedFeatures(z: ZoneSpec): Promise<{ name: string; kind: Landmark["kind"]; lat: number; lon: number; ele?: number }[]> {
  const around = `(around:${REAL_RADIUS * 0.95},${z.lat},${z.lon})`;
  const q = `[out:json][timeout:60];(
    node["name"]["natural"~"^(peak|waterfall|tree|rock|cliff|saddle|spring|cave_entrance|arch)$"]${around};
    node["name"]["waterway"="waterfall"]${around};
    node["name"]["tourism"~"^(viewpoint|attraction|picnic_site|camp_site)$"]${around};
    node["name"]["historic"]${around};
  );out tags;`;
  for (let i = 0; i < 5; i++) {
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }), headers: { "user-agent": "rustybuns-park-hide-seek/0.1" } });
    if (r.ok) {
      const j = await r.json() as { elements: { lat: number; lon: number; tags: Record<string, string> }[] };
      return j.elements.map((e) => {
        const t = e.tags;
        const kind: Landmark["kind"] = t.natural === "peak" ? "peak" : t.natural === "waterfall" || t.waterway === "waterfall" ? "falls"
          : t.natural === "spring" ? "spring" : t.natural === "arch" ? "arch" : t.natural === "cave_entrance" ? "cave" : "view";
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
