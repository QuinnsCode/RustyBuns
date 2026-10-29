// The 177 countries of Natural Earth's 1:110m map (public domain, via the world-atlas package): their
// outlines for the globe, a point-in-country test for where a disc lands, and a seeded land point inside
// one for a tee or a basket.
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import topology from "world-atlas/countries-110m.json";
import type { LatLon } from "./geo.ts";

/** A [lon, lat] point as GeoJSON writes it. */
export type Position = number[];

export interface Country {
  id: string;
  name: string;
  rings: Position[][];   // every ring of every polygon, [lon, lat] points, outer rings and holes alike
  outer: Position[][];   // the outer rings only (holes are rare at this scale; Lesotho, San Marino)
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
  areaDeg: number;       // bbox area in square degrees: a coarse size for picking playable countries
}

type CountriesTopology = Topology<{ countries: GeometryCollection<{ name: string }> }>;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
/** world-atlas ships the file; this checks it is the TopoJSON topojson-client reads before trusting it. */
function isCountriesTopology(x: unknown): x is CountriesTopology {
  if (!isObj(x) || x.type !== "Topology" || !Array.isArray(x.arcs) || !isObj(x.objects)) return false;
  const c = x.objects.countries;
  return isObj(c) && c.type === "GeometryCollection" && Array.isArray(c.geometries);
}

function build(): Country[] {
  const topo: unknown = topology;
  if (!isCountriesTopology(topo)) throw new Error("world-atlas/countries-110m.json is not the TopoJSON expected");
  const fc = feature(topo, topo.objects.countries);
  const out: Country[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const rings: Position[][] = [], outer: Position[][] = [];
    let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
    for (const poly of polys) {
      poly.forEach((ring, k) => { rings.push(ring); if (k === 0) outer.push(ring); });
      for (const [lon, lat] of poly[0]!) {
        if (lon! < minLon) minLon = lon!; if (lon! > maxLon) maxLon = lon!;
        if (lat! < minLat) minLat = lat!; if (lat! > maxLat) maxLat = lat!;
      }
    }
    const name = f.properties?.name ?? String(f.id);
    out.push({ id: String(f.id ?? name), name, rings, outer, bbox: [minLon, minLat, maxLon, maxLat], areaDeg: (maxLon - minLon) * (maxLat - minLat) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

let cache: Country[] | undefined;
export function countries(): Country[] { return (cache ??= build()); }

/** Ray casting in lon/lat. Good enough away from the poles and the date line, which is where no basket sits. */
function inRing(ring: Position[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi! > lat !== yj! > lat && lon < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}
export function inCountry(c: Country, p: LatLon): boolean {
  const [a, b, d, e] = c.bbox;
  if (p.lon < a || p.lon > d || p.lat < b || p.lat > e) return false;
  // Inside an odd number of rings (an outer ring, minus any hole).
  let n = 0;
  for (const ring of c.rings) if (inRing(ring, p.lon, p.lat)) n++;
  return n % 2 === 1;
}
/** The country a point is in, or null for the sea (and the 110m map's gaps). */
export function countryAt(p: LatLon, list = countries()): Country | null {
  for (const c of list) if (inCountry(c, p)) return c;
  return null;
}

/** A point inside the country, from a [0,1) random stream. Falls back to an outline point if the bbox is mostly sea. */
export function landPoint(c: Country, rnd: () => number): LatLon {
  const [a, b, d, e] = c.bbox;
  for (let k = 0; k < 60; k++) {
    const p = { lon: a + rnd() * (d - a), lat: b + rnd() * (e - b) };
    if (inCountry(c, p)) return p;
  }
  const ring = c.outer[Math.floor(rnd() * c.outer.length)]!;
  const [lon, lat] = ring[Math.floor(rnd() * ring.length)]!;
  return { lon: lon!, lat: lat! };
}
