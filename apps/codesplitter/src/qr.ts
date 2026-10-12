// A QR code for a link, with nothing fetched: the desktop's 📱 drawer draws the pairing link with it
// (built to /qr.js), and `bun run phone` prints it in the terminal. Byte mode, error correction M,
// versions 1 to 40, the mask with the lowest penalty. After Project Nayuki's QR Code generator (MIT).

/** Error-correction codewords per block, and blocks, for level M, by version (index 0 unused). */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
/** Level M's two format bits. */
const LEVEL_M = 0;

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** Modules left for data and error correction once the function patterns are drawn. */
function rawModules(ver: number) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
const dataCodewords = (ver: number) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver]! * BLOCKS[ver]!;

/** GF(2^8) multiply, modulo x^8 + x^4 + x^3 + x^2 + 1. */
function mul(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisor(degree: number) {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mul(r[j]!, root);
      if (j + 1 < r.length) r[j]! ^= r[j + 1]!;
    }
    root = mul(root, 0x02);
  }
  return r;
}
function remainder(data: number[], div: number[]) {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift()!;
    r.push(0);
    div.forEach((c, i) => { r[i]! ^= mul(c, f); });
  }
  return r;
}

/** The data codewords for `bytes`, in the smallest version that holds them. */
function encode(bytes: Uint8Array) {
  let ver = 1;
  const bitsFor = (v: number) => 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
  while (bitsFor(ver) > dataCodewords(ver) * 8) if (++ver > 40) throw new Error("too long for a QR code");
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return { ver, data: out };
}

/** Split into blocks, add each one's error correction, and interleave. */
function withEcc(ver: number, data: number[]) {
  const n = BLOCKS[ver]!, eccLen = ECC_PER_BLOCK[ver]!, raw = Math.floor(rawModules(ver) / 8);
  const short = n - (raw % n), shortLen = Math.floor(raw / n), div = divisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < n; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < short ? 0 : 1));
    k += dat.length;
    const ecc = remainder(dat, div);
    if (i < short) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++)
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= short) out.push(b[i]!); });
  return out;
}

function alignments(ver: number, size: number) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Lower is easier to scan: long runs, 2×2 blocks, finder look-alikes and a lopsided dark count all cost. */
function penalty(m: boolean[][]) {
  const size = m.length;
  let p = 0, dark = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) { run++; continue; }
      if (run >= 5) p += run - 2;
      run = 1;
    }
    // 1:1:3:1:1 with four light modules on a side
    for (let i = 0; i + 11 <= size; i++) {
      const s = Array.from({ length: 11 }, (_, k) => get(i + k));
      const core = s[0] && !s[1] && s[2] && s[3] && s[4] && !s[5] && s[6];
      if (core && !s[7] && !s[8] && !s[9] && !s[10]) p += 40;
      const core2 = s[4] && !s[5] && s[6] && s[7] && s[8] && !s[9] && s[10];
      if (core2 && !s[0] && !s[1] && !s[2] && !s[3]) p += 40;
    }
  };
  for (let y = 0; y < size; y++) {
    line((x) => m[y]![x]!);
    line((x) => m[x]![y]!);
    for (let x = 0; x < size; x++) {
      if (m[y]![x]) dark++;
      if (y + 1 < size && x + 1 < size) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) p += 3;
      }
    }
  }
  const total = size * size;
  p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return p;
}

/** The QR code for `text` as rows of modules, true for dark, without the quiet zone. */
export function qr(text: string): boolean[][] {
  const { ver, data } = encode(new TextEncoder().encode(text));
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { m[y]![x] = dark; fixed[y]![x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const)
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  const al = alignments(ver, size);
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const format = (mask: number) => {
    const d = (LEVEL_M << 3) | mask;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
    set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i));
    set(8, size - 8, true);
  };
  format(0); // reserve its modules before the data goes in
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), c = Math.floor(i / 3);
      set(a, c, bit(b, i)); set(c, a, bit(b, i));
    }
  }

  const all = withEcc(ver, data);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!fixed[y]![x] && i < all.length * 8) { m[y]![x] = bit(all[i >>> 3]!, 7 - (i & 7)); i++; }
    }
  }

  const flip = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y]![x] && MASKS[mask]!(x, y)) m[y]![x] = !m[y]![x];
  };
  let best = 0, lowest = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    flip(mask); format(mask);
    const p = penalty(m);
    if (p < lowest) { lowest = p; best = mask; }
    flip(mask);
  }
  flip(best); format(best);
  return m;
}

/** An SVG of the code, with the four-module quiet zone, dark on light whatever the theme. */
export function qrSvg(text: string): string {
  const m = qr(text), n = m.length + 8;
  let d = "";
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4},${y + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** The code in a terminal: two rows to a line with half blocks, light on dark so it reads on a dark theme too. */
export function qrText(text: string): string {
  const m = qr(text), n = m.length;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && m[y]![x]!;
  const lines: string[] = [];
  for (let y = -2; y < n + 2; y += 2) {
    let s = "";
    // light modules print as the block, so the code shows on any background with its quiet zone
    for (let x = -2; x < n + 2; x++) {
      const top = !at(x, y), bottom = !at(x, y + 1);
      s += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(s);
  }
  return lines.join("\n");
}
