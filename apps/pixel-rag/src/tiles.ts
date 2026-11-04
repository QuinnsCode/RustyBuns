// Screenshots to an index: cut each page into overlapping tiles, skip blank and repeated ones
// (dhash), embed the rest with the crate, and pack them to codes in the shared memory. Asking is
// the same steps for one tile, then a search and a full-precision rescore of the best few.
import type { Page } from "./corpus.ts";
import { SharedIndex, type Hit } from "./engine/index.ts";
import { DIMS, WORDS, WORDS32 } from "./engine/layout.ts";

export const TILE = 160, STRIDE = 80;

export interface Tile { page: number; x: number; y: number }
export interface Corpus { index: SharedIndex; pages: Page[]; tiles: Tile[]; vecs: Float32Array; ms: { embed: number }; skipped: { blank: number; repeat: number } }
export interface Match extends Hit, Tile { score: number }

const VEC = 4096; // one vector's bytes in scratch

function spots(w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y + TILE <= h; y += STRIDE) for (let x = 0; x + TILE <= w; x += STRIDE) out.push([x, y]);
  return out;
}

/** Load a page's pixels into scratch; returns its byte length. */
function load(c: Corpus | { index: SharedIndex }, page: Page): number {
  const { width, height } = page.canvas;
  const px = page.canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  c.index.local.u8(c.index.layout.scratch + VEC, px.length).set(px);
  return px.length;
}

export async function buildCorpus(pages: Page[], wasm: Uint8Array | null): Promise<Corpus> {
  const capacity = pages.reduce((n, p) => n + spots(p.canvas.width, p.canvas.height).length, 0);
  const biggest = Math.max(...pages.map((p) => p.canvas.width * p.canvas.height * 4));
  const index = await SharedIndex.create({ capacity, scratch: VEC + biggest, wasm });
  const l = index.layout, vec = l.scratch, img = l.scratch + VEC;
  const tiles: Tile[] = [];
  const vecs = new Float32Array(capacity * DIMS);
  const seen = new Set<bigint>();
  const skipped = { blank: 0, repeat: 0 };
  const t0 = performance.now();
  pages.forEach((page, p) => {
    const bytes = load({ index }, page);
    const w = page.canvas.width;
    for (const [x, y] of spots(w, page.canvas.height)) {
      const h = index.local.dhash(img, bytes, w, x, y, TILE);
      if (seen.has(h)) { skipped.repeat++; continue; }
      index.local.embed(img, bytes, w, x, y, TILE, vec);
      const v = index.local.f32(vec, DIMS);
      // A blank tile has no edges, so its edge block comes back all zeros: nothing to find there.
      let edges = 0;
      for (let i = 3 * 256; i < DIMS; i++) edges += Math.abs(v[i]);
      if (edges === 0) { skipped.blank++; continue; }
      seen.add(h);
      const row = tiles.length;
      vecs.set(v, row * DIMS);
      index.local.quantize(vec, 1, DIMS, l.codes + row * WORDS * 8);
      tiles.push({ page: p, x, y });
    }
  });
  index.used = tiles.length;
  return { index, pages, tiles, vecs, ms: { embed: performance.now() - t0 }, skipped };
}

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/** The tiles most like the one at (x, y) on page `p`: a bit search for 64, rescored, best `k`. */
export async function ask(c: Corpus, p: number, x: number, y: number, k = 12): Promise<{ matches: Match[]; ms: number; searchMs: number; tile: Tile }> {
  const t0 = performance.now();
  const page = c.pages[p], l = c.index.layout, vec = l.scratch, img = l.scratch + VEC;
  const bytes = load(c, page);
  // Snap to the tile grid, so a click asks with a tile the index holds.
  const snap = (v: number, max: number) => Math.max(0, Math.min(Math.floor((max - TILE) / STRIDE) * STRIDE, Math.round((v - TILE / 2) / STRIDE) * STRIDE));
  const tx = snap(x, page.canvas.width), ty = snap(y, page.canvas.height);
  c.index.local.embed(img, bytes, page.canvas.width, tx, ty, TILE, vec);
  const q = new Float32Array(c.index.local.f32(vec, DIMS));
  const code = new Uint32Array(WORDS32);
  // The page's pixels are done with, so its first bytes take the query's code.
  c.index.local.quantize(vec, 1, DIMS, img);
  code.set(c.index.local.u32(img, WORDS32));
  const s = await c.index.search(code, 64);
  const matches = s.hits.map((h) => ({ ...h, ...c.tiles[h.row], score: cosine(q, c.vecs.subarray(h.row * DIMS, (h.row + 1) * DIMS)) }));
  matches.sort((a, b) => b.score - a.score);
  return { matches: matches.slice(0, k), ms: performance.now() - t0, searchMs: s.ms, tile: { page: p, x: tx, y: ty } };
}
