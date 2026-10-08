// Builds src/parks/data/<code>.json from real maps. Run it to refresh or add a
// park; the output is committed, so the app itself never downloads anything.
//
//   bun scripts/fetch-parks.ts            all parks in PARKS
//   bun scripts/fetch-parks.ts yose zion  just these
//   --force                               refetch parks already on disk
//
// Boundaries: the National Park Service's public boundary service (public domain).
// Peaks, lakes, rivers, roads and sights: OpenStreetMap via Overpass (ODbL),
// credited in the app and the README.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inRings, project, ringArea, simplify, bounds, lineDist, type Pt } from "../src/geo.ts";
import type { ParkData, Landmark, LandmarkKind } from "../src/parks/types.ts";

interface ParkSpec { code: string; name: string; state: string; start: string }

// `start` names the seeker's trailhead: a visitor centre or landmark found in OSM.
const PARKS: ParkSpec[] = [
  { code: "YOSE", name: "Yosemite", state: "California", start: "Valley Visitor Center" },
  { code: "YELL", name: "Yellowstone", state: "Wyoming, Montana, Idaho", start: "Old Faithful" },
  { code: "GRCA", name: "Grand Canyon", state: "Arizona", start: "Grand Canyon Visitor Center" },
  { code: "ZION", name: "Zion", state: "Utah", start: "Zion Canyon Visitor Center" },
  { code: "ACAD", name: "Acadia", state: "Maine", start: "Hulls Cove Visitor Center" },
  { code: "ARCH", name: "Arches", state: "Utah", start: "Arches National Park Visitor Center" },
  { code: "GLAC", name: "Glacier", state: "Montana", start: "Logan Pass Visitor Center" },
  { code: "GRSM", name: "Great Smoky Mountains", state: "Tennessee, North Carolina", start: "Sugarlands Visitor Center" },
];

const NPS = "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const UA = "rustybuns-park-hide-seek/0.1 (example app; github.com/QuinnsCode/RustyBuns)";
const OUT = join(import.meta.dir, "../src/parks/data");

const MAX = { peak: 45, water: 30, sight: 45 } as const;

async function get(url: string, init?: RequestInit, tries = 4): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init?.headers ?? {}) } });
    if (r.ok) return r.json();
    if (i + 1 >= tries || ![429, 502, 503, 504].includes(r.status)) throw new Error(`${r.status} ${url.slice(0, 80)}: ${(await r.text()).slice(0, 200)}`);
    const wait = 10000 * (i + 1);
    console.log(`  ${r.status}, retrying in ${wait / 1000}s`);
    await Bun.sleep(wait);
  }
}

async function boundary(code: string): Promise<[number, number][][]> {
  const q = new URLSearchParams({ where: `UNIT_CODE='${code}'`, outFields: "UNIT_CODE", returnGeometry: "true", maxAllowableOffset: "0.001", outSR: "4326", f: "geojson" });
  const j = await get(`${NPS}?${q}`);
  const rings: [number, number][][] = [];
  for (const f of j.features ?? []) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const p of polys) rings.push(p[0]); // outer ring only; holes are private inholdings
  }
  if (!rings.length) throw new Error(`no boundary for ${code}`);
  return rings;
}

async function overpass(b: { s: number; w: number; n: number; e: number }): Promise<any[]> {
  const bb = `(${b.s},${b.w},${b.n},${b.e})`;
  // Three smaller queries: one big one times out on parks the size of Yellowstone.
  const parts = [
    `node["natural"~"^(peak|volcano|waterfall|geyser|hot_spring|arch|cave_entrance)$"]["name"]${bb};
     node["waterway"="waterfall"]["name"]${bb};
     node["tourism"="viewpoint"]["name"]${bb};
     nwr["name"~"Visitor"]${bb};`,
    `way["natural"="water"]["name"]${bb};
     relation["natural"="water"]["name"]${bb};`,
    `way["waterway"="river"]${bb};
     way["highway"~"^(trunk|primary|secondary|tertiary)$"]${bb};`,
  ];
  const out: any[] = [];
  for (const body of parts) {
    const j = await get(OVERPASS, { method: "POST", body: new URLSearchParams({ data: `[out:json][timeout:180];(${body});out center tags geom;` }) }, 6);
    out.push(...(j.elements ?? []));
    await Bun.sleep(2000);
  }
  return out;
}

/** Join way segments that share endpoints into closed rings (OSM multipolygon outers). */
function stitch(parts: Pt[][]): Pt[][] {
  const open = parts.map((p) => p.slice());
  const rings: Pt[][] = [];
  const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
  while (open.length) {
    let cur = open.pop()!;
    let grew = true;
    while (!same(cur[0], cur[cur.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const p = open[i];
        const end = cur[cur.length - 1];
        if (same(end, p[0])) cur = cur.concat(p.slice(1));
        else if (same(end, p[p.length - 1])) cur = cur.concat(p.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4) rings.push(cur);
  }
  return rings;
}

/** Keep the runs of a line that lie inside the park. */
function clip(line: Pt[], inside: (p: Pt) => boolean): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (const p of line) {
    if (inside(p)) run.push(p);
    else { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const rp = (p: Pt): Pt => [r2(p[0]), r2(p[1])];

function landmarkKind(t: Record<string, string>): LandmarkKind | null {
  if (t.natural === "peak" || t.natural === "volcano") return "peak";
  if (t.natural === "waterfall" || t.waterway === "waterfall") return "falls";
  if (t.natural === "geyser") return "geyser";
  if (t.natural === "hot_spring") return "spring";
  if (t.natural === "arch") return "arch";
  if (t.natural === "cave_entrance") return "cave";
  if (t.tourism === "viewpoint") return "view";
  return null;
}

async function build(spec: ParkSpec): Promise<ParkData> {
  console.log(`${spec.code} ${spec.name}`);
  const rawRings = await boundary(spec.code);
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of rawRings) for (const [lon, lat] of r) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
  const lon0 = (w + e) / 2, lat0 = (s + n) / 2;
  const P = (lon: number, lat: number) => project(lon, lat, lon0, lat0);

  let rings = rawRings.map((r) => r.map(([lon, lat]) => P(lon, lat)));
  const biggest = Math.max(...rings.map(ringArea));
  rings = rings.filter((r) => ringArea(r) >= biggest * 0.01);
  const bb = bounds(rings);
  const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
  const tol = span * 0.0015;
  const outline = rings.map((r) => simplify(r, tol).map(rp)).filter((r) => r.length >= 4);
  const inside = (p: Pt) => inRings(p[0], p[1], rings);

  console.log(`  boundary: ${outline.length} ring(s), ${outline.reduce((a, r) => a + r.length, 0)} pts, ${span.toFixed(1)} km across`);
  const els = await overpass({ s, w, n, e });
  console.log(`  osm: ${els.length} elements`);

  const geomOf = (el: any): Pt[] => (el.geometry ?? []).map((g: any) => P(g.lon, g.lat));
  const lakes: ParkData["lakes"] = [];
  const rivers: ParkData["rivers"] = [];
  const roads: ParkData["roads"] = [];
  const marks: (Landmark & { ele: number })[] = [];
  let start: Landmark | null = null;
  const seen = new Set<string>();

  for (const el of els) {
    const t = el.tags ?? {};
    if (t.natural === "water" && el.type !== "node") {
      const parts: Pt[][] = el.type === "relation"
        ? stitch((el.members ?? []).filter((m: any) => m.role !== "inner" && m.geometry).map((m: any) => m.geometry.map((g: any) => P(g.lon, g.lat))))
        : [geomOf(el)];
      for (const ring of parts) {
        if (ring.length < 4 || !ring.some(inside)) continue;
        const area = ringArea(ring);
        if (area < span * span * 0.00002) continue;
        lakes.push({ name: t.name, ring: simplify(ring, tol).map(rp), area: r2(area) });
      }
    } else if (t.waterway === "river" && el.type === "way") {
      for (const run of clip(geomOf(el), inside)) rivers.push({ name: t.name ?? "", line: simplify(run, tol).map(rp) });
    } else if (t.highway && el.type === "way") {
      for (const run of clip(geomOf(el), inside)) roads.push({ name: t.name ?? t.ref ?? "", line: simplify(run, tol).map(rp) });
    } else {
      // Nodes carry lat/lon; ways come back with bounds (geom output has no center).
      const b = el.bounds;
      const lat = el.lat ?? el.center?.lat ?? (b && (b.minlat + b.maxlat) / 2), lon = el.lon ?? el.center?.lon ?? (b && (b.minlon + b.maxlon) / 2);
      if (lat === undefined) continue;
      const [x, y] = P(lon, lat);
      if (!inside([x, y])) continue;
      if (!start && typeof t.name === "string" && t.name.toLowerCase().includes(spec.start.toLowerCase())) start = { name: t.name, kind: "start", x: r2(x), y: r2(y) };
      const kind = landmarkKind(t);
      if (!kind) continue;
      const key = `${kind}:${t.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ele = Number.parseFloat(t.ele ?? "") || 0;
      marks.push({ name: t.name, kind, x: r2(x), y: r2(y), ...(ele ? { ele: Math.round(ele) } : { ele: 0 }) });
    }
  }

  // Keep the tallest peaks and the biggest lakes; spread the sights out.
  const peaks = marks.filter((m) => m.kind === "peak").sort((a, b) => b.ele - a.ele).slice(0, MAX.peak);
  const sights = spreadOut(marks.filter((m) => m.kind !== "peak"), MAX.sight, span * 0.02);
  lakes.sort((a, b) => b.area - a.area).splice(MAX.water);
  const landmarks: Landmark[] = [...peaks, ...sights].map(({ ele, ...m }) => (ele ? { ...m, ele } : m));
  if (!start) {
    console.log(`  ! no "${spec.start}" in OSM, starting at the centre`);
    start = { name: "Park centre", kind: "start", x: 0, y: 0 };
  }
  console.log(`  ${peaks.length} peaks, ${lakes.length} lakes, ${rivers.length} river runs, ${roads.length} road runs, ${sights.length} sights; start ${start.name}`);

  return {
    code: spec.code, name: spec.name, state: spec.state,
    center: [Math.round(lon0 * 1e5) / 1e5, Math.round(lat0 * 1e5) / 1e5],
    outline, lakes, rivers: rivers.filter((r) => r.line.length > 1), roads: roads.filter((r) => r.line.length > 1),
    landmarks, start,
  };
}

/** Greedy pick that skips anything within minGap of one already kept. */
function spreadOut<T extends { x: number; y: number }>(items: T[], max: number, minGap: number): T[] {
  const out: T[] = [];
  for (const it of items) {
    if (out.length >= max) break;
    if (out.every((o) => lineDist(it.x, it.y, [[o.x, o.y]]) >= minGap)) out.push(it);
  }
  return out;
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const want = args.filter((a) => !a.startsWith("--")).map((s) => s.toUpperCase());
mkdirSync(OUT, { recursive: true });
const failed: string[] = [];
for (const spec of PARKS) {
  if (want.length && !want.includes(spec.code)) continue;
  const file = join(OUT, `${spec.code.toLowerCase()}.json`);
  if (!force && !want.length && existsSync(file)) { console.log(`${spec.code} already fetched (--force to refresh)`); continue; }
  let data: ParkData;
  // Overpass is a shared free service and times out under load: keep going, report at the end.
  try { data = await build(spec); } catch (err) { console.log(`  ! ${spec.code} failed: ${String(err).slice(0, 120)}`); failed.push(spec.code); continue; }
  writeFileSync(file, JSON.stringify(data));
  console.log(`  -> ${file} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
  await Bun.sleep(3000); // be polite to Overpass
}
if (failed.length) { console.log(`failed: ${failed.join(" ")} (Overpass was busy; run again later)`); process.exit(1); }
