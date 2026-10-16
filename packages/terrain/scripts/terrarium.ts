// Terrarium elevation tiles (the public AWS "Terrain Tiles" dataset, built from USGS 3DEP and other public
// sources), read without an image library. Shared by the scripts that write packages/terrain/src/zones.
import { inflateSync } from "node:zlib";

const ZOOM = 14;
const TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

// A minimal PNG reader: 8-bit RGB/RGBA, non-interlaced (what Terrarium serves).
export function decodePng(buf: Uint8Array): { w: number; h: number; rgb: (x: number, y: number) => [number, number, number] } {
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

export async function elevation(lon: number, lat: number): Promise<number> {
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

