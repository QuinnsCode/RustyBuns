// A GRIB2 reader for one kind of file: NOAA's GFS wind grids as NOMADS hands them out (lat/lon grid,
// template 3.0; product template 4.0; complex packing with spatial differencing, template 5.3, or simple
// packing, 5.0; no bitmap). It gives back u and v (east and north, m/s) on the grid, and a bilinear
// sample at any lat/lon. Anything else in the file is skipped, and a message it can't read says why.
// Spec: WMO FM 92 GRIB edition 2 (https://codes.wmo.int/grib2), NCEP's notes on the templates.

export interface Grid {
  ni: number;       // columns (longitude)
  nj: number;       // rows (latitude)
  la1: number;      // first row's latitude, degrees (north is +)
  lo1: number;      // first column's longitude, degrees [0, 360)
  di: number;       // longitude step, degrees (+ east)
  dj: number;       // latitude step, degrees (+ going south, as GFS scans)
}

export interface Field {
  grid: Grid;
  parameter: string;    // "UGRD" | "VGRD" | "param-<cat>-<num>"
  level: string;        // "10 m above ground", "250 mb", ...
  values: Float32Array; // row-major, j*ni + i
  cycle: Date;          // the model run (reference time)
  forecastHours: number;
}

/** u and v on one grid at one level: what the game's wind is. */
export interface WindLevel {
  grid: Grid;
  level: string;
  u: Float32Array;
  v: Float32Array;
}

class Bits {
  private pos: number; // bit position
  constructor(private b: Uint8Array, byteOffset: number) { this.pos = byteOffset * 8; }
  read(n: number): number {
    let v = 0;
    for (let k = 0; k < n; k++) {
      const byte = this.b[this.pos >> 3]!;
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
  /** Skip to the next whole byte (GRIB pads each packed array to an octet). */
  align() { this.pos = (this.pos + 7) & ~7; }
}

const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
/** GRIB2 signed integers are sign-and-magnitude, not two's complement. */
const sgn16 = (dv: DataView, at: number) => { const r = dv.getUint16(at); return (r & 0x8000 ? -1 : 1) * (r & 0x7fff); };
const sgnN = (b: Uint8Array, at: number, n: number) => {
  let v = b[at]! & 0x7f;
  for (let k = 1; k < n; k++) v = v * 256 + b[at + k]!;
  return (b[at]! & 0x80 ? -1 : 1) * v;
};

const PARAMS: Record<string, string> = { "0-2-2": "UGRD", "0-2-3": "VGRD" };
function levelName(type: number, value: number): string {
  if (type === 103) return `${value} m above ground`;
  if (type === 100) return `${Math.round(value / 100)} mb`;
  if (type === 1) return "surface";
  return `level-${type}-${value}`;
}

/** Every field in a GRIB2 file this reader understands. */
export function readGrib2(bytes: Uint8Array): Field[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Field[] = [];
  let p = 0;
  while (p + 16 <= bytes.length) {
    if (text(bytes, p, 4) !== "GRIB") throw new Error(`not GRIB at byte ${p}`);
    if (bytes[p + 7] !== 2) throw new Error(`GRIB edition ${bytes[p + 7]}, want 2`);
    const discipline = bytes[p + 6]!;
    const total = Number(dv.getBigUint64(p + 8));
    const end = p + total;
    if (text(bytes, end - 4, 4) !== "7777") throw new Error("message has no 7777 trailer");
    // Sections may repeat inside one message (3, 4, 5, 6, 7 again); the latest of each applies.
    let grid: Grid | undefined, cycle = new Date(0), product: { parameter: string; level: string; hours: number } | undefined;
    let repr: { at: number; len: number } | undefined, bitmap = 255;
    let q = p + 16;
    while (q < end - 4) {
      const len = dv.getUint32(q), sec = bytes[q + 4]!;
      if (sec === 1) {
        cycle = new Date(Date.UTC(dv.getUint16(q + 12), bytes[q + 14]! - 1, bytes[q + 15]!, bytes[q + 16]!, bytes[q + 17]!, bytes[q + 18]!));
      } else if (sec === 3) {
        const tmpl = dv.getUint16(q + 12);
        if (tmpl !== 0) throw new Error(`grid template 3.${tmpl}, only 3.0 (lat/lon) is read`);
        const scan = bytes[q + 71]!;
        if (scan !== 0) throw new Error(`scanning mode ${scan}, only 0 (west to east, north to south) is read`);
        grid = {
          ni: dv.getUint32(q + 30), nj: dv.getUint32(q + 34),
          la1: dv.getInt32(q + 46) / 1e6, lo1: dv.getUint32(q + 50) / 1e6,
          di: dv.getUint32(q + 63) / 1e6, dj: dv.getUint32(q + 67) / 1e6,
        };
      } else if (sec === 4) {
        const tmpl = dv.getUint16(q + 7);
        if (tmpl !== 0 && tmpl !== 1 && tmpl !== 8) throw new Error(`product template 4.${tmpl} is not read`);
        const key = `${discipline}-${bytes[q + 9]}-${bytes[q + 10]}`;
        const unit = bytes[q + 17]!; // 0 minute, 1 hour, 2 day
        const t = dv.getUint32(q + 18);
        const hours = unit === 1 ? t : unit === 0 ? t / 60 : unit === 2 ? t * 24 : t;
        const scale = sgnN(bytes, q + 23, 1);
        const value = sgnN(bytes, q + 24, 4) / 10 ** scale;
        product = { parameter: PARAMS[key] ?? `param-${key}`, level: levelName(bytes[q + 22]!, value), hours };
      } else if (sec === 5) {
        repr = { at: q, len };
      } else if (sec === 6) {
        bitmap = bytes[q + 5]!;
      } else if (sec === 7) {
        if (!grid || !product || !repr) throw new Error("data section before grid, product or packing");
        if (bitmap !== 255) throw new Error(`bitmap indicator ${bitmap}: files with a bitmap are not read`);
        const values = unpack(bytes, dv, repr.at, q, len, grid.ni * grid.nj);
        out.push({ grid, parameter: product.parameter, level: product.level, values, cycle, forecastHours: product.hours });
      }
      q += len;
    }
    p = end;
  }
  return out;
}

/** Section 5 + 7 to numbers. Templates 5.0 (simple) and 5.3 (complex, spatial differencing). */
function unpack(b: Uint8Array, dv: DataView, s5: number, s7: number, s7len: number, n: number): Float32Array {
  const npts = dv.getUint32(s5 + 5);
  if (npts !== n) throw new Error(`packed ${npts} points for a grid of ${n}`);
  const tmpl = dv.getUint16(s5 + 9);
  const R = dv.getFloat32(s5 + 11);
  const E = sgn16(dv, s5 + 15), D = sgn16(dv, s5 + 17);
  const nbits = b[s5 + 19]!;
  const scale = 2 ** E / 10 ** D;
  const out = new Float32Array(n);
  if (tmpl === 0) {
    const bits = new Bits(b, s7 + 5);
    for (let i = 0; i < n; i++) out[i] = (R + (nbits ? bits.read(nbits) : 0) * 2 ** E) / 10 ** D;
    return out;
  }
  if (tmpl !== 2 && tmpl !== 3) throw new Error(`packing template 5.${tmpl} is not read`);
  if (b[s5 + 22] !== 0) throw new Error("missing-value management in complex packing is not read");
  const ng = dv.getUint32(s5 + 31);
  const refW = b[s5 + 35]!, bitsW = b[s5 + 36]!;
  const refL = dv.getUint32(s5 + 37), incL = b[s5 + 41]!, lastL = dv.getUint32(s5 + 42), bitsL = b[s5 + 46]!;
  const order = tmpl === 3 ? b[s5 + 47]! : 0;
  const nd = tmpl === 3 ? b[s5 + 48]! : 0;
  const d = new Int32Array(n);
  let at = s7 + 5;
  const first: number[] = [];
  let gmin = 0;
  if (order) {
    for (let k = 0; k < order; k++) { first.push(sgnN(b, at, nd)); at += nd; }
    gmin = sgnN(b, at, nd); at += nd;
  }
  const bits = new Bits(b, at);
  const refs = new Int32Array(ng), widths = new Uint8Array(ng), lengths = new Int32Array(ng);
  for (let g = 0; g < ng; g++) refs[g] = bits.read(nbits);
  bits.align();
  for (let g = 0; g < ng; g++) widths[g] = refW + (bitsW ? bits.read(bitsW) : 0);
  bits.align();
  for (let g = 0; g < ng; g++) lengths[g] = refL + incL * (bitsL ? bits.read(bitsL) : 0);
  lengths[ng - 1] = lastL;
  bits.align();
  let i = 0;
  for (let g = 0; g < ng; g++) {
    const w = widths[g]!, r = refs[g]!, L = lengths[g]!;
    if (i + L > n) throw new Error(`groups cover ${i + L} points of ${n}`);
    for (let k = 0; k < L; k++) d[i++] = r + (w ? bits.read(w) : 0);
  }
  if (i !== n) throw new Error(`groups cover ${i} points of ${n}`);
  if (order === 1) {
    d[0] = first[0]!;
    for (let k = 1; k < n; k++) d[k] = d[k]! + gmin + d[k - 1]!;
  } else if (order === 2) {
    d[0] = first[0]!; d[1] = first[1]!;
    for (let k = 2; k < n; k++) d[k] = d[k]! + gmin + 2 * d[k - 1]! - d[k - 2]!;
  }
  for (let k = 0; k < n; k++) out[k] = (R + d[k]! * 2 ** E) / 10 ** D;
  void scale; void s7len;
  return out;
}

/** Pair the u and v fields of each level. Levels with only one of the two are left out. */
export function windLevels(fields: Field[]): WindLevel[] {
  const byLevel = new Map<string, Partial<Record<"UGRD" | "VGRD", Field>>>();
  for (const f of fields) {
    if (f.parameter !== "UGRD" && f.parameter !== "VGRD") continue;
    const e = byLevel.get(f.level) ?? {};
    e[f.parameter] = f;
    byLevel.set(f.level, e);
  }
  const out: WindLevel[] = [];
  for (const [level, e] of byLevel) {
    if (e.UGRD && e.VGRD) out.push({ grid: e.UGRD.grid, level, u: e.UGRD.values, v: e.VGRD.values });
  }
  return out;
}

/** Wind at a point, bilinear on the grid, wrapping in longitude. Returns [u, v] in m/s. */
export function sampleWind(w: WindLevel, lat: number, lon: number, out: [number, number] = [0, 0]): [number, number] {
  const { ni, nj, la1, lo1, di, dj } = w.grid;
  let x = (((lon - lo1) % 360) + 360) % 360 / di;
  let y = (la1 - lat) / dj;
  if (y < 0) y = 0; else if (y > nj - 1) y = nj - 1;
  const i0 = Math.floor(x), j0 = Math.floor(y);
  const fx = x - i0, fy = y - j0;
  const i1 = (i0 + 1) % ni, j1 = Math.min(j0 + 1, nj - 1);
  const a = j0 * ni + i0, b = j0 * ni + i1, c = j1 * ni + i0, d = j1 * ni + i1;
  const mix = (arr: Float32Array) => (arr[a]! * (1 - fx) + arr[b]! * fx) * (1 - fy) + (arr[c]! * (1 - fx) + arr[d]! * fx) * fy;
  out[0] = mix(w.u); out[1] = mix(w.v);
  return out;
}
