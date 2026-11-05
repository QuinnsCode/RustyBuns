// Every lane gives the same answer: the crate as wasm on one shared memory, the crate over
// bun:ffi, and the TypeScript twin, from the tile vectors to the top k of a million codes.
// Lanes without a build (no `bun run build:native`) are skipped and say so.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ptr } from "bun:ffi";
import { SharedIndex, type Engine } from "../src/engine/index.ts";
import { nativeLib } from "../src/engine/native.ts";
import { DIMS, WORDS32 } from "../src/engine/layout.ts";
import * as twin from "../src/engine/twin.ts";
import { raceOnHost } from "../src/actions/race.ts";

setDefaultTimeout(60_000);
const WASM = join(import.meta.dir, "..", "public", "pixel_rag.wasm");
const wasm = existsSync(WASM) ? new Uint8Array(await Bun.file(WASM).arrayBuffer()) : null;
const native = await nativeLib();
if (!wasm || !native) console.log(`  (skipping ${[!wasm && "wasm", !native && "native"].filter(Boolean).join(" and ")}: run \`bun run build:native\`)`);
const spawn = () => new Worker(new URL("../src/engine/host-worker.ts", import.meta.url));

/** A page-like picture: bands, boxes and a gradient, so every feature block has something in it. */
function picture(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, box = (x % 97 < 40 && y % 61 < 25) ? 200 : 0;
    px[i] = (x * 3 + box) & 255; px[i + 1] = (y * 5) & 255; px[i + 2] = ((x ^ y) + box) & 255; px[i + 3] = 255;
  }
  return px;
}

describe("the crate and its twin agree, bit for bit", async () => {
  const W = 400, H = 300, px = picture(W, H);
  const ix = await SharedIndex.create({ capacity: 4, scratch: px.length + 4 * DIMS * 4, wasm });
  const l = ix.layout, img = l.scratch, vec = l.scratch + px.length;
  ix.local.u8(img, px.length).set(px);
  const tiles = [[0, 0, 160], [37, 51, 160], [240, 140, 160], [100, 100, 45]] as const;

  test.each(tiles)("tile at %i,%i (%i px)", (x, y, size) => {
    const ts = twin.embed(px, W, x, y, size);
    ix.local.embed(img, px.length, W, x, y, size, vec);
    expect([...ix.local.f32(vec, DIMS)]).toEqual([...ts]);
    expect(ix.local.dhash(img, px.length, W, x, y, size)).toBe(twin.dhash(px, W, x, y, size));
    if (native) {
      const out = new Float32Array(DIMS);
      native.pr_embed(ptr(px), W, x, y, size, ptr(out));
      expect([...out]).toEqual([...ts]);
      expect(BigInt.asUintN(64, BigInt(native.pr_dhash(ptr(px), W, x, y, size)))).toBe(twin.dhash(px, W, x, y, size));
    }
    const code = new Uint32Array(WORDS32);
    twin.quantize(ts, 1, DIMS, code);
    ix.local.quantize(vec, 1, DIMS, l.codes);
    expect([...ix.local.u32(l.codes, WORDS32)]).toEqual([...code]);
  });

  test("a blank tile has no edges, which is how the indexer skips it", () => {
    expect(twin.embed(new Uint8Array(200 * 200 * 4).fill(180), 200, 0, 0, 160).subarray(3 * 256).every((v) => v === 0)).toBe(true);
  });
});

describe("a million codes, one shared memory, every lane", async () => {
  const N = 1_000_000, ROW = 424_242, K = 10;
  const ix = await SharedIndex.create({ capacity: N, wasm });
  ix.fillRandom(11);
  const ref = new Uint32Array(N * WORDS32);
  twin.fill(ref, 11);
  const q = ref.slice(ROW * WORDS32, (ROW + 1) * WORDS32);
  q[3] ^= 0b101;

  test("the fill is the twin's, so the host and the page index the same bits", () => {
    expect(ix.codes()).toEqual(ref);
  });

  const main = await ix.search(q, K);
  test("the row the query came from is first, two bits off", () => {
    expect(main.hits[0]).toEqual({ row: ROW, dist: 2 });
    expect(main.hits.length).toBe(K);
  });

  const lanes: [string, number, Engine[]][] = [
    ["twin workers", 3, ["ts"]],
    ["wasm workers", 4, ["wasm"]],
    ["native workers", 4, ["native"]],
    ["native and wasm side by side", 4, ["native", "wasm"]],
  ];
  test.each(lanes)("%s give the same top %#", async (_name, n, engines) => {
    if ((engines.includes("wasm") && !wasm) || (engines.includes("native") && !native)) return;
    await ix.start(n, engines, spawn);
    try {
      expect((await ix.search(q, K)).hits).toEqual(main.hits);
    } finally {
      ix.stop();
    }
  });

  test("the desktop host's race finds the same top k on its own index", async () => {
    if (!native) return;
    const h = await raceOnHost(N, 11, ROW, K, 2, ["native"]);
    // raceOnHost flips bit 0 of word 0 instead, so its query is one bit off the row.
    expect(h.hits[0]).toEqual({ row: ROW, dist: 1 });
    expect(h.hits.length).toBe(K);
  });
});
