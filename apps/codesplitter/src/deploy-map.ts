// The deploy and health map (map.html): a stack's `rustybuns infra --json` graphs drawn on a
// world that wraps sideways. This file is the map's logic with no DOM, so tests read it; the
// build ships it to the page as deploy-map.js.
//
// A node sits where its `location` says: a Cloudflare colo (IATA code), a provider region
// ("aws:eu-west-1", "hetzner:fsn1") or "lat,lon". Nodes with none are listed, not drawn.

export interface MapNode {
  id: string; kind: string; label: string; name?: string; note?: string;
  /** colo, region or "lat,lon" */
  location?: string;
  /** cloudflare by default; "aws", "hetzner", "railway" ... for a box */
  provider?: string;
  health?: { status: "up" | "degraded" | "down"; errors?: number; p50?: number; p95?: number; url?: string };
}
export interface MapGraph { app: string; stage?: string; nodes: MapNode[] }
export type Mode = "locale" | "app" | "provider";
export const MODES: Mode[] = ["locale", "app", "provider"];

/** Land, 5-degree bands: [top latitude, [from lon, to lon][]]. Coarse on purpose, drawn as a grid of dots. */
export const LAND: [number, [number, number][]][] = [
  [80, [[-70, -20], [-120, -75], [10, 30], [95, 115]]],
  [75, [[-125, -80], [-72, -20], [80, 115], [130, 150]]],
  [70, [[-165, -95], [-90, -60], [-55, -20], [5, 30], [30, 180]]],
  [65, [[-170, -55], [-52, -25], [-24, -14], [5, 30], [30, 175]]],
  [60, [[-170, -55], [-45, -42], [5, 30], [30, 165]]],
  [55, [[-165, -55], [-10, 0], [5, 30], [30, 160]]],
  [50, [[-128, -55], [-10, 2], [0, 160]]],
  [45, [[-125, -60], [-5, 40], [50, 145], [135, 143]]],
  [40, [[-125, -70], [-10, 45], [45, 125], [130, 142]]],
  [35, [[-120, -75], [-10, 125], [126, 140]]],
  [30, [[-118, -80], [-17, 122]]],
  [25, [[-112, -80], [-17, 60], [65, 122]]],
  [20, [[-105, -85], [-85, -75], [-17, 55], [72, 80], [98, 110]]],
  [15, [[-100, -60], [-17, 50], [75, 82], [100, 110]]],
  [10, [[-85, -60], [-17, 50], [78, 80], [100, 110]]],
  [5, [[-80, -50], [-15, 50], [98, 105], [110, 118]]],
  [0, [[-80, -50], [10, 42], [95, 105], [110, 118], [120, 135]]],
  [-5, [[-80, -35], [12, 40], [105, 150]]],
  [-10, [[-78, -35], [14, 40], [130, 150]]],
  [-15, [[-75, -40], [14, 48], [130, 150]]],
  [-20, [[-70, -40], [14, 35], [43, 50], [115, 152]]],
  [-25, [[-70, -45], [15, 35], [115, 152]]],
  [-30, [[-72, -50], [17, 33], [115, 152]]],
  [-35, [[-72, -58], [18, 30], [135, 150]]],
  [-40, [[-72, -62], [145, 148], [172, 178]]],
  [-45, [[-74, -66], [168, 174]]],
  [-50, [[-74, -68]]],
  [-70, [[-180, 180]]],
];
export const LAT_TOP = 80, LAT_BOTTOM = -75, STEP = 5;

/** Land cells as [lon, lat] centres. */
export function landCells(): [number, number][] {
  const out: [number, number][] = [];
  for (const [top, ranges] of LAND) for (const [a, b] of ranges)
    for (let lon = Math.ceil((a + 2.5) / STEP) * STEP - 2.5; lon <= b; lon += STEP) if (lon >= a) out.push([lon, top - STEP / 2]);
  return out;
}

/** Cloudflare colos by IATA code, and provider regions, as [lat, lon]. */
export const PLACES: Record<string, [number, number]> = {
  SJC: [37.4, -121.9], LAX: [34.1, -118.4], SEA: [47.4, -122.3], DEN: [39.9, -104.7], DFW: [32.9, -97], ORD: [41.9, -87.9],
  IAD: [38.9, -77.5], EWR: [40.7, -74.2], ATL: [33.6, -84.4], MIA: [25.8, -80.3], YYZ: [43.7, -79.6], GRU: [-23.4, -46.5],
  SCL: [-33.4, -70.8], LHR: [51.5, -0.5], CDG: [49, 2.5], AMS: [52.3, 4.8], FRA: [50, 8.6], MAD: [40.5, -3.6], MXP: [45.6, 8.7],
  ARN: [59.7, 17.9], WAW: [52.2, 21], JNB: [-26.1, 28.2], CPT: [-34, 18.6], DXB: [25.3, 55.4], BOM: [19.1, 72.9], DEL: [28.6, 77.1],
  SIN: [1.4, 104], HKG: [22.3, 113.9], NRT: [35.8, 140.4], KIX: [34.4, 135.2], ICN: [37.5, 126.4], SYD: [-33.9, 151.2], MEL: [-37.7, 144.8], AKL: [-37, 174.8],
  "aws:us-east-1": [38.9, -77.5], "aws:us-west-2": [45.8, -119.7], "aws:eu-west-1": [53.3, -6.3], "aws:eu-central-1": [50.1, 8.7],
  "aws:ap-southeast-1": [1.3, 103.8], "aws:ap-northeast-1": [35.7, 139.7], "aws:sa-east-1": [-23.5, -46.6],
  "hetzner:fsn1": [50.5, 12.4], "hetzner:nbg1": [49.5, 11.1], "hetzner:hel1": [60.2, 24.9], "hetzner:ash": [39, -77.5], "hetzner:hil": [45.5, -122.9],
  "railway:us-west2": [37.4, -121.9], "railway:us-east4": [39, -77.5], "railway:europe-west4": [53.4, 6.8], "railway:asia-southeast1": [1.3, 103.8],
};

/** Where a node is: a known colo or region (any case), or "lat,lon". */
export function locate(n: MapNode): [number, number] | null {
  const loc = n.location?.trim();
  if (!loc) return null;
  const hit = PLACES[loc] ?? PLACES[loc.toUpperCase()] ?? PLACES[loc.toLowerCase()];
  if (hit) return hit;
  const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(loc);
  if (!m) return null;
  const lat = +m[1]!, lon = +m[2]!;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

export const providerOf = (n: MapNode) => (n.provider ?? "cloudflare").toLowerCase();

/** Equirectangular: lon/lat to x/y in a w-wide map. */
export function project(lat: number, lon: number, w: number): [number, number] {
  const h = w * (LAT_TOP - LAT_BOTTOM) / 360;
  return [(lon + 180) / 360 * w, (LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM) * h];
}

/** x after the map is dragged by `offset` pixels: always inside [0, w), so the world loops. */
export const wrapX = (x: number, offset: number, w: number) => ((x + offset) % w + w) % w;

/** The point on Earth the sun is over at `d`: [lat, lon]. */
export function sunPoint(d: Date): [number, number] {
  const day = (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const lat = -23.44 * Math.cos(2 * Math.PI * (day + 10) / 365);
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60;
  let lon = (12 - hours) * 15;
  lon = ((lon + 540) % 360) - 180;
  return [lat, lon];
}

/** Whether the sun is below the horizon at lat/lon. */
export function isNight(lat: number, lon: number, d: Date): boolean {
  const [slat, slon] = sunPoint(d), r = Math.PI / 180;
  return Math.sin(lat * r) * Math.sin(slat * r) + Math.cos(lat * r) * Math.cos(slat * r) * Math.cos((lon - slon) * r) < 0;
}

export const ORANGE = "#e8590c";
const PALETTE = ["#e8590c", "#1c7ed6", "#2f9e44", "#ae3ec9", "#f08c00", "#0c8599", "#d6336c", "#5c7cfa"];
const PROVIDERS: Record<string, string> = { cloudflare: "#e8590c", aws: "#f08c00", hetzner: "#c92a2a", railway: "#7048e8" };

/** What colours each node, by mode: locale is one orange, app one hue per app, provider one per host. */
export function colourFor(mode: Mode, app: string, n: MapNode, apps: string[]): string {
  if (mode === "locale") return ORANGE;
  if (mode === "app") return PALETTE[Math.max(0, apps.indexOf(app)) % PALETTE.length]!;
  const p = providerOf(n);
  return PROVIDERS[p] ?? PALETTE[(Object.keys(PROVIDERS).length + [...p].reduce((a, c) => a + c.charCodeAt(0), 0)) % PALETTE.length]!;
}

export const STATUS_COLOUR = { up: "#2f9e44", degraded: "#f08c00", down: "#e03131" } as const;

/** The graphs a page was given: one, or a list. Throws on anything that isn't a stack. */
export function readGraphs(raw: unknown): MapGraph[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((g) => {
    const o = g as MapGraph;
    if (!o || typeof o.app !== "string" || !Array.isArray(o.nodes)) throw new Error("not an infra graph: needs app and nodes");
    return o;
  });
}

/** A dot to draw: the node, its app, where, and its colour. Nodes with no place come back in `unplaced`. */
export function layout(graphs: MapGraph[], mode: Mode) {
  const apps = graphs.map((g) => g.app), dots: { app: string; node: MapNode; lat: number; lon: number; colour: string }[] = [], unplaced: { app: string; node: MapNode }[] = [];
  for (const g of graphs) for (const node of g.nodes) {
    const at = locate(node);
    if (at) dots.push({ app: g.app, node, lat: at[0], lon: at[1], colour: colourFor(mode, g.app, node, apps) });
    else unplaced.push({ app: g.app, node });
  }
  return { dots, unplaced };
}
