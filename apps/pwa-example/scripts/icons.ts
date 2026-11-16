// Draws the app's icons (a die showing five, on the accent orange) into public/icons/ as PNGs: 192 and 512 for the
// manifest, and a maskable 512 whose die sits inside the middle 80% that Android's round and squircle masks keep.
// Android installs a PWA only with PNG icons this size. The output is checked in; `bun run icons` draws it again.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const ORANGE = [0xe8, 0x59, 0x0c], WHITE = [0xff, 0xff, 0xff], CREAM = [0xff, 0xf8, 0xf0];

/** One RGB picture, `size` square, painted a pixel at a time by `paint(x, y)` in [0, 1) coordinates. */
function draw(size: number, paint: (x: number, y: number) => number[]) {
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) rows.set(paint((x + 0.5) / size, (y + 0.5) / size), y * (size * 3 + 1) + 1 + x * 3);
  }
  return png(size, rows);
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return ~c >>> 0; };
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
  return out;
}
function png(size: number, rows: Buffer) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** Inside a rounded square centred on (.5, .5), `half` wide each way, corners of radius `r`. */
const inRounded = (x: number, y: number, half: number, r: number) => {
  const dx = Math.max(Math.abs(x - 0.5) - (half - r), 0), dy = Math.max(Math.abs(y - 0.5) - (half - r), 0);
  return Math.abs(x - 0.5) <= half && Math.abs(y - 0.5) <= half && dx * dx + dy * dy <= r * r;
};
const PIPS = [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]];

/** The die (white, orange pips) at `scale` of the picture, over `bg`; outside the icon's own corners, `edge`. */
function die(scale: number, bg: number[], edge: number[] | null) {
  return (x: number, y: number) => {
    if (edge && !inRounded(x, y, 0.5, 0.18)) return edge;
    const half = 0.5 * scale;
    if (!inRounded(x, y, half, half * 0.28)) return bg;
    const step = half * 0.5, pip = half * 0.16;
    return PIPS.some(([i, j]) => (x - 0.5 - i! * step) ** 2 + (y - 0.5 - j! * step) ** 2 <= pip * pip) ? ORANGE : WHITE;
  };
}

const out = join(import.meta.dir, "../public/icons");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "192.png"), draw(192, die(0.62, ORANGE, CREAM)));
writeFileSync(join(out, "512.png"), draw(512, die(0.62, ORANGE, CREAM)));
writeFileSync(join(out, "maskable-512.png"), draw(512, die(0.5, ORANGE, null)));
console.log(`icons in ${out}`);
