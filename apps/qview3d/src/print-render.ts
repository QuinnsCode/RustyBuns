// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Print files made in the Worker, the same PNG the admin page draws (print-sheet.ts drawSheet): each original laid
// over the zone at 300 dpi, clear around it, cut at the zone's edge, its dpi written in.
//
// Decoding is WASM (jsquash's PNG, MozJPEG and libwebp decoders, about 480 KB together, Apache-2.0): a Worker has no
// image codecs of its own. Everything after that is plain TS: the picture is boxed down to about the size it prints,
// each sheet pixel sampled back through the widget's placement (bilinear, premultiplied alpha), and the rows streamed
// through CompressionStream into the PNG a strip at a time, so a 30 x 40 cm sheet never sits in memory unpacked.
//
// A Worker has 128 MB, and a decoded picture takes 4 bytes a pixel twice over (in the decoder, then copied out), so
// originals over PRINT_MAX_PX are left for the admin page to draw (the sheet says why).
import { init as initJpeg } from "@jsquash/jpeg/decode";
import decodeJpeg from "@jsquash/jpeg/decode";
import { init as initPng, decode as decodePng } from "@jsquash/png/decode";
import { init as initWebp } from "@jsquash/webp/decode";
import decodeWebp from "@jsquash/webp/decode";
import jpegWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import pngWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import webpWasm from "@jsquash/webp/codec/dec/webp_dec.wasm";
import type { PrintSheet } from "./api.ts";
import { crc32, sheetLayout, withDpi } from "./print-sheet.ts";

/** The largest original made into a print file here: a 12 MP phone photo fits. */
export const PRINT_MAX_PX = 12_600_000;

/** A `.wasm` import: a compiled module on Cloudflare, a file path on Bun. */
const compiled = async (m: WebAssembly.Module | string) => (typeof m === "string" ? WebAssembly.compile(await (await fetch(Bun.pathToFileURL(m))).arrayBuffer()) : m);
const emscripten = (m: WebAssembly.Module) => ({
  instantiateWasm(imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) {
    const i = new WebAssembly.Instance(m, imports);
    done(i);
    return i.exports;
  },
});
let ready: Promise<unknown> | undefined;
const codecs = () =>
  (ready ??= Promise.all([
    compiled(pngWasm).then((m) => initPng(m)),
    compiled(jpegWasm).then((m) => initJpeg(emscripten(m))),
    compiled(webpWasm).then((m) => initWebp(emscripten(m))),
  ]));

export type Picture = { data: Uint8ClampedArray; width: number; height: number };

/** The picture's size from its header, before anything is decoded; null when it can't be read. */
export function pictureSize(b: Uint8Array): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const at = (s: string, i: number) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length > 24 && b[0] === 0x89 && at("PNG", 1)) return { width: v.getUint32(16), height: v.getUint32(20) };
  if (b.length > 30 && at("RIFF", 0) && at("WEBP", 8)) {
    if (at("VP8X", 12)) return { width: 1 + (v.getUint32(24, true) & 0xffffff), height: 1 + (v.getUint32(27, true) & 0xffffff) };
    if (at("VP8L", 12)) { const n = v.getUint32(21, true); return { width: 1 + (n & 0x3fff), height: 1 + ((n >> 14) & 0x3fff) }; }
    if (at("VP8 ", 12)) return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: v.getUint16(i + 7), height: v.getUint16(i + 5) };
      i += 2 + v.getUint16(i + 2);
    }
  }
  return null;
}

/** The original's pixels (straight alpha, turned upright as its EXIF says, as the browser shows it), or why not. */
export async function decodePicture(bytes: Uint8Array<ArrayBuffer>, maxPx = PRINT_MAX_PX): Promise<Picture | string> {
  const size = pictureSize(bytes);
  if (!size) return "the original isn't a PNG, JPEG or WebP this can read";
  if (size.width * size.height > maxPx) return `the original is over ${Math.floor(PRINT_MAX_PX / 1e6)} MP: draw it on /admin.html`;
  await codecs();
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  try {
    const img = bytes[0] === 0x89 ? await decodePng(buf) : bytes[0] === 0xff ? await decodeJpeg(buf, { preserveOrientation: true }) : await decodeWebp(buf);
    return { data: img.data, width: img.width, height: img.height };
  } catch (e) {
    return `the original couldn't be decoded: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`;
  }
}

/** The picture boxed down by a whole factor, alpha premultiplied: what is sampled from. */
function premultiplied(p: Picture, f: number): Picture {
  const w = Math.ceil(p.width / f), h = Math.ceil(p.height / f);
  const out = new Uint8ClampedArray(w * h * 4);
  const src = p.data;
  for (let y = 0; y < h; y++) {
    const y0 = y * f, y1 = Math.min(p.height, y0 + f);
    for (let x = 0; x < w; x++) {
      const x0 = x * f, x1 = Math.min(p.width, x0 + f);
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0, i = (yy * p.width + x0) * 4; xx < x1; xx++, i += 4) {
          const al = src[i + 3]!;
          r += src[i]! * al; g += src[i + 1]! * al; b += src[i + 2]! * al; a += al;
        }
      }
      const n = (y1 - y0) * (x1 - x0), o = (y * w + x) * 4;
      out[o] = r / 255 / n; out[o + 1] = g / 255 / n; out[o + 2] = b / 255 / n; out[o + 3] = a / n;
    }
  }
  return { data: out, width: w, height: h };
}

const STRIP = 64;

/** One picture ready to lay on a sheet: boxed down to about the size it prints there, premultiplied, and its true aspect. */
export type Boxed = Picture & { aspect: number };

/** Box a decoded original down for its place on the sheet, so the full-size one can go before the next is decoded. */
export function boxFor(picture: Picture, px: PrintSheet["px"], at: PrintSheet["pictures"][number]["at"]): Boxed {
  const aspect = picture.width / picture.height, w = sheetLayout(px, at, aspect).w;
  return { ...premultiplied(picture, Math.max(1, Math.floor(picture.width / w))), aspect };
}

/**
 * The sheet's PNG, with its dpi: each picture (`boxed[i]` for `sheet.pictures[i]`) where its placement puts it, the
 * last on top, as drawSheet draws them on the page.
 */
export async function renderSheet(sheet: PrintSheet, boxed: Boxed[], dpi: number): Promise<Uint8Array<ArrayBuffer>> {
  const W = sheet.px.w, H = sheet.px.h;
  const layers = sheet.pictures.flatMap((p, i) => {
    const src = boxed[i];
    if (!src) return [];
    const { x, y, w, h, rotation } = sheetLayout(sheet.px, p.at, src.aspect);
    return [{ x, y, w, h, src, kx: src.width / w, ky: src.height / h, cos: Math.cos(rotation), sin: Math.sin(rotation) }];
  });
  const px = new Float64Array(4);

  const deflate = new CompressionStream("deflate");
  const packed = new Response(deflate.readable).arrayBuffer();
  const writer = deflate.writable.getWriter();
  for (let y0 = 0; y0 < H; y0 += STRIP) {
    const rows = Math.min(STRIP, H - y0), row = 1 + W * 4;
    const strip = new Uint8Array(rows * row);
    for (let r = 0; r < rows; r++) {
      for (let X = 0; X < W; X++) {
        let R = 0, G = 0, B = 0, A = 0;
        for (const l of layers) {
          if (!sample(l, X + 0.5, y0 + r + 0.5, px)) continue;
          const keep = 1 - px[3]! / 255;
          R = px[0]! + R * keep; G = px[1]! + G * keep; B = px[2]! + B * keep; A = px[3]! + A * keep;
        }
        if (A < 0.5) continue;
        const o = r * row + 1 + X * 4, k = 255 / A;
        strip[o] = Math.round(R * k); strip[o + 1] = Math.round(G * k); strip[o + 2] = Math.round(B * k);
        strip[o + 3] = Math.round(A);
      }
    }
    await writer.write(strip);
  }
  await writer.close();
  const idat = new Uint8Array(await packed);

  const chunk = (type: string, body: Uint8Array) => {
    const c = new Uint8Array(12 + body.length), v = new DataView(c.buffer);
    v.setUint32(0, body.length);
    c.set([...type].map((ch) => ch.charCodeAt(0)), 4);
    c.set(body, 8);
    v.setUint32(8 + body.length, crc32(c.subarray(4, 8 + body.length)));
    return c;
  };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, W); hv.setUint32(4, H);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, adaptive filters, not interlaced
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (png.set(p, at), at + p.length), 0);
  return withDpi(png, dpi);
}

type Placed = { x: number; y: number; w: number; h: number; src: Boxed; kx: number; ky: number; cos: number; sin: number };

/** One picture's premultiplied colour at a sheet spot, into `out` (0..255 each); false where it doesn't reach. */
function sample(l: Placed, X: number, Y: number, out: Float64Array): boolean {
  const { src, w, h, kx, ky, cos, sin } = l, sw = src.width, sh = src.height, d = src.data;
  const dx = X - l.x, dy = Y - l.y;
  // Back through the page's translate(x, y) rotate(-rotation): sheet pixel to picture pixel.
  const sx = (dx * cos - dy * sin + w / 2) * kx - 0.5, sy = (dx * sin + dy * cos + h / 2) * ky - 0.5;
  if (sx <= -1 || sy <= -1 || sx >= sw || sy >= sh) return false;
  const tx = Math.floor(sx), ty = Math.floor(sy), fx = sx - tx, fy = sy - ty;
  // The four texels around it and their weights; one outside the picture counts as clear.
  const inL = tx >= 0, inR = tx + 1 < sw, inT = ty >= 0, inB = ty + 1 < sh;
  const i00 = (ty * sw + tx) * 4, i01 = i00 + sw * 4;
  const w00 = inL && inT ? (1 - fx) * (1 - fy) : 0, w10 = inR && inT ? fx * (1 - fy) : 0;
  const w01 = inL && inB ? (1 - fx) * fy : 0, w11 = inR && inB ? fx * fy : 0;
  for (let c = 0; c < 4; c++) out[c] = (w00 && w00 * d[i00 + c]!) + (w10 && w10 * d[i00 + 4 + c]!) + (w01 && w01 * d[i01 + c]!) + (w11 && w11 * d[i01 + 4 + c]!);
  return true;
}
