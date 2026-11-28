// An animated GIF from raw frames, ours so the page takes on no dependency: one palette of up to 256 colours for the
// whole animation (median cut over every frame, so colours don't flicker between frames), then LZW. No DOM: bytes in,
// bytes out.

export interface Gif {
  width: number;
  height: number;
  /** Each frame's pixels, RGBA, width * height * 4 long (a canvas's ImageData). Alpha is ignored. */
  frames: readonly Uint8ClampedArray[];
  /** How long each frame shows. */
  delayMs: number;
}

/** A colour at 5 bits a channel: the histogram's bucket. */
const bucket = (p: Uint8ClampedArray, i: number) => ((p[i]! >> 3) << 10) | ((p[i + 1]! >> 3) << 5) | (p[i + 2]! >> 3);
const channel = (key: number, c: number) => (key >> (10 - c * 5)) & 31;

/** The palette (RGB triples) and each bucket's index in it. */
function medianCut(frames: Gif["frames"]) {
  const count = new Float64Array(32768), sums = new Float64Array(32768 * 3);
  for (const p of frames) for (let i = 0; i < p.length; i += 4) {
    const k = bucket(p, i);
    count[k]!++;
    for (let c = 0; c < 3; c++) sums[k * 3 + c]! += p[i + c]!;
  }
  // A box of buckets, with its widest channel and how much splitting it would help (pixels times that width).
  const box = (keys: number[]) => {
    let widest = 0, range = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 31, hi = 0;
      for (const k of keys) { lo = Math.min(lo, channel(k, c)); hi = Math.max(hi, channel(k, c)); }
      if (hi - lo > range) { range = hi - lo; widest = c; }
    }
    const pixels = keys.reduce((n, k) => n + count[k]!, 0);
    return { keys, widest, pixels, worth: range * pixels };
  };
  const boxes = [box(Array.from({ length: 32768 }, (_, k) => k).filter((k) => count[k]! > 0))];
  while (boxes.length < 256) {
    const split = boxes.reduce((best, b) => (b.worth > best.worth ? b : best));
    if (split.worth === 0) break;
    split.keys.sort((a, b) => channel(a, split.widest) - channel(b, split.widest));
    let at = 0, seen = 0;
    while (at < split.keys.length - 1 && seen < split.pixels / 2) seen += count[split.keys[at++]!]!;
    boxes.splice(boxes.indexOf(split), 1, box(split.keys.slice(0, at)), box(split.keys.slice(at)));
  }
  const palette = new Uint8Array(256 * 3), index = new Uint8Array(32768);
  boxes.forEach((b, n) => {
    for (let c = 0; c < 3; c++) palette[n * 3 + c] = Math.round(b.keys.reduce((s, k) => s + sums[k * 3 + c]!, 0) / b.pixels);
    for (const k of b.keys) index[k] = n;
  });
  return { palette, index };
}

/** GIF's LZW over palette indexes (8-bit), packed into its sub-blocks. */
function lzw(pixels: Uint8Array, out: number[]) {
  const CLEAR = 256, END = 257;
  const codes = new Map<number, number>();
  let next = 258, size = 9, held = 0, bits = 0;
  const block: number[] = [];
  const flush = () => { if (block.length) out.push(block.length, ...block); block.length = 0; };
  const byte = (b: number) => { block.push(b); if (block.length === 255) flush(); };
  const emit = (code: number) => {
    held |= code << bits;
    bits += size;
    while (bits >= 8) { byte(held & 255); held >>>= 8; bits -= 8; }
  };
  out.push(8);
  emit(CLEAR);
  let run = pixels[0]!;
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i]!, key = run * 256 + k, found = codes.get(key);
    if (found !== undefined) { run = found; continue; }
    emit(run);
    if (next < 4096) {
      if (next >= 1 << size && size < 12) size++;
      codes.set(key, next++);
    } else {
      emit(CLEAR);
      codes.clear();
      next = 258;
      size = 9;
    }
    run = k;
  }
  emit(run);
  emit(END);
  if (bits) byte(held & 255);
  flush();
  out.push(0);
}

export function encodeGif({ width, height, frames, delayMs }: Gif): Uint8Array<ArrayBuffer> {
  const { palette, index } = medianCut(frames);
  const out: number[] = [];
  const text = (s: string) => out.push(...Array.from(s, (c) => c.charCodeAt(0)));
  const word = (n: number) => out.push(n & 255, (n >> 8) & 255);
  text("GIF89a");
  word(width);
  word(height);
  out.push(0xf7, 0, 0, ...palette); // a global table of 256 colours
  out.push(0x21, 0xff, 11);
  text("NETSCAPE2.0");
  out.push(3, 1, 0, 0, 0); // loops for ever
  for (const p of frames) {
    out.push(0x21, 0xf9, 4, 4); // keep the frame in place
    word(Math.max(2, Math.round(delayMs / 10)));
    out.push(0, 0, 0x2c, 0, 0, 0, 0);
    word(width);
    word(height);
    out.push(0);
    const pixels = new Uint8Array(width * height);
    for (let i = 0; i < pixels.length; i++) pixels[i] = index[bucket(p, i * 4)]!;
    lzw(pixels, out);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}
