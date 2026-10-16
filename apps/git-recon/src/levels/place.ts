// Any place on Earth as a level: the ground around a lat/long, read in the page
// from the public AWS "Terrain Tiles" dataset (Terrarium PNGs, served with
// Access-Control-Allow-Origin: *), the same decode as Park Hide & Seek's
// scripts/fetch-zones.ts but with the browser's own DecompressionStream for zlib.
// The result is a ZoneData, so heightmapTerrain() takes it like El Capitan's.

import type { ZoneData } from "@rustybuns/terrain";

export const TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
export const ZOOM = 14;

export type TileSource = (z: number, x: number, y: number) => Promise<Uint8Array>;

export const fetchTile: TileSource = async (z, x, y) => {
  const r = await fetch(`${TILES}/${z}/${x}/${y}.png`);
  if (!r.ok) throw new Error(`elevation tile ${z}/${x}/${y}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};

async function inflate(chunks: Uint8Array[]): Promise<Uint8Array> {
  const out = new Blob(chunks as BlobPart[]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export interface Pixels { w: number; h: number; rgb(x: number, y: number): [number, number, number] }

/** A minimal PNG reader: 8-bit RGB/RGBA, non-interlaced, which is what Terrarium serves. */
export async function decodePng(buf: Uint8Array): Promise<Pixels> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8, w = 0, h = 0, ch = 3;
  const idat: Uint8Array[] = [];
  while (p < buf.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(p + 8), h = dv.getUint32(p + 12);
      const depth = data[8], color = data[9], interlace = data[12];
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) throw new Error(`unsupported PNG (depth ${depth}, color ${color})`);
      ch = color === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const raw = await inflate(idat);
  const stride = w * ch, px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch]! : 0, b = y ? px[(y - 1) * stride + x]! : 0, c = x >= ch && y ? px[(y - 1) * stride + x - ch]! : 0;
      let v = src[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, rgb: (x, y) => { const i = y * stride + x * ch; return [px[i]!, px[i + 1]!, px[i + 2]!]; } };
}

/** Web Mercator: lon/lat to global pixel coordinates at ZOOM. */
export function worldPx(lon: number, lat: number): [number, number] {
  const n = 256 * 2 ** ZOOM, s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

/** Reads "37.7459, -119.5332" (or space-separated) as a place; null if it isn't one. */
export function parsePlace(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  // Web Mercator stops short of the poles.
  return Math.abs(lat) <= 84 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export interface PlaceOptions { realRadius?: number; n?: number; tiles?: TileSource }

/** The ground `realRadius` metres round a place, as a ZoneData: n*n Int16 metres, row 0 the south edge. */
export async function groundAt(lat: number, lon: number, opts: PlaceOptions = {}): Promise<ZoneData> {
  const { realRadius = 1000, n = 81, tiles = fetchTile } = opts;
  const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const at = (c: number, r: number): [number, number] => {
    const ex = -realRadius + (2 * realRadius * c) / (n - 1), ny = -realRadius + (2 * realRadius * r) / (n - 1);
    return worldPx(lon + ex / mPerDegLon, lat + ny / mPerDegLat);
  };

  // Every tile the disc's square touches, fetched together before any sampling.
  const [x0, y0] = at(0, n - 1), [x1, y1] = at(n - 1, 0);
  const pending = new Map<string, Promise<Pixels>>();
  for (let ty = Math.floor((y0 - 1) / 256); ty <= Math.floor((y1 + 1) / 256); ty++)
    for (let tx = Math.floor((x0 - 1) / 256); tx <= Math.floor((x1 + 1) / 256); tx++)
      pending.set(`${tx}/${ty}`, tiles(ZOOM, tx, ty).then(decodePng));
  const loaded = new Map<string, Pixels>();
  await Promise.all([...pending].map(async ([k, p]) => loaded.set(k, await p)));

  const metres = (x: number, y: number) => {
    const [r, g, b] = loaded.get(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`)!.rgb(((x % 256) + 256) % 256, ((y % 256) + 256) % 256);
    return r * 256 + g + b / 256 - 32768;
  };
  const heights = new Int16Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      // Bilinear between the four nearest pixels.
      const [gx, gy] = at(c, r);
      const px = Math.floor(gx - 0.5), py = Math.floor(gy - 0.5), fx = gx - 0.5 - px, fy = gy - 0.5 - py;
      const v = metres(px, py) * (1 - fx) * (1 - fy) + metres(px + 1, py) * fx * (1 - fy) + metres(px, py + 1) * (1 - fx) * fy + metres(px + 1, py + 1) * fx * fy;
      heights[r * n + c] = Math.round(v);
    }
  }
  let bin = "";
  for (const byte of new Uint8Array(heights.buffer)) bin += String.fromCharCode(byte);
  const id = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  return { id, name: placeName(lat, lon), center: [lon, lat], realRadius, n, heights: btoa(bin) };
}

/** 37.7459, -119.5332 as 37.7459° N 119.5332° W. */
export function placeName(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? "W" : "E"}`;
}
