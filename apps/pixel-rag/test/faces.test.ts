// The face path end to end on real photos (public/faces, public domain): find every face, fingerprint
// it, index it after a page's worth of tiles in one shared index, then click a face and get the same
// person's photos back, and nobody else's. Each lane the page has runs it: the wasm lane in the
// page's own face worker (src/faces/face-worker.ts, as a Bun worker), and the native lane (the
// crate's ONNX Runtime over bun:ffi) when there is a Rust build with it (not --lite). The first
// run downloads the models (about 10 MB, `bun run models`).
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decode as jpeg } from "jpeg-js";
import { ensureModels } from "../scripts/models.ts";
import { SharedIndex } from "../src/engine/index.ts";
import { DIMS } from "../src/engine/layout.ts";
import { nativeFaces } from "../src/engine/native.ts";
import { askFace, findFaces, indexFaces, sameFaces, type Face, type Pixels } from "../src/faces/face.ts";
import { faceLane } from "../src/faces/lanes.ts";
import { nativeInfer } from "../src/faces/native.ts";

setDefaultTimeout(120_000);
const DIR = join(import.meta.dir, "..", "public", "faces");
const names = readdirSync(DIR).filter((f) => f.endsWith(".jpg")).sort();
const found: { wasm: Face[]; native: Face[] | null } = { wasm: [], native: null };

beforeAll(async () => {
  const models = await ensureModels();
  const photos: Pixels[] = await Promise.all(names.map(async (n) => jpeg(new Uint8Array(await Bun.file(join(DIR, n)).arrayBuffer()), { useTArray: true })));
  const lane = await faceLane(() => new Worker(new URL("../src/faces/face-worker.ts", import.meta.url)), "wasm", pathToFileURL(models).href + "/", 1);
  for (const [i, p] of photos.entries()) found.wasm.push(...(await lane.find(p, i)).faces);
  lane.stop();
  if (await nativeFaces()) {
    const infer = await nativeInfer(models);
    found.native = [];
    for (const [i, p] of photos.entries()) found.native.push(...(await findFaces(infer, p, i)));
  }
});

const who = (f: Face) => names[f.page].replace(/\.jpg$/, "");

for (const lane of ["wasm", "native"] as const) {
  describe(`${lane} lane`, () => {
    const faces = () => {
      const f = found[lane];
      if (!f) console.log(`native lane skipped: no Rust build with faces here (bun run build:native, not --lite)`);
      return f;
    };
    /** The pictures that come back for the face on `photo` (the rightmost one there). */
    async function same(all: Face[], photo: string): Promise<string[]> {
      const tiles = 500; // the rows before the faces, as a page's tiles would be
      const index = await SharedIndex.create({ capacity: tiles + all.length, scratch: DIMS * 4, wasm: null });
      index.used = tiles + all.length;
      indexFaces(index, all, tiles, index.layout.scratch);
      const mine = all.filter((f) => who(f) === photo).sort((a, b) => b.box[0] - a.box[0])[0];
      const { matches } = await askFace(index, all, tiles, all.indexOf(mine));
      expect(matches.every((m) => m.row >= tiles)).toBe(true);
      return [...new Set(matches.map((m) => who(all[m.face])))].sort();
    }

    test("finds one face on each portrait and all six on the crew photo", () => {
      const all = faces();
      if (!all) return;
      const count = (photo: string) => all.filter((f) => who(f) === photo).length;
      for (const p of ["koch-emu", "koch-artemis", "meir-emu", "meir-wb57", "whitson"]) expect(count(p)).toBe(1);
      expect(count("expedition-59")).toBe(6);
    });

    test("a face finds the same person across photos, and only them", async () => {
      const all = faces();
      if (!all) return;
      // The crew photo's rightmost face is the same astronaut as the two koch portraits.
      expect(await same(all, "expedition-59")).toEqual(["expedition-59", "koch-artemis", "koch-emu"]);
      expect(await same(all, "meir-emu")).toEqual(["meir-emu", "meir-wb57"]);
      expect(await same(all, "whitson")).toEqual(["whitson"]);
    });
  });
}

test("the native lane finds the same faces as the wasm lane, photo by photo", () => {
  if (!found.native) return;
  for (const [i] of names.entries()) {
    const on = (all: Face[]) => all.filter((f) => f.page === i);
    expect(sameFaces(on(found.wasm), on(found.native))).toBe(true);
  }
});
