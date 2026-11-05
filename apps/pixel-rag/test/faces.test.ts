// The face path end to end on real photos (public/faces, public domain): find every face, fingerprint
// it, index it after a page's worth of tiles in one shared index, then click a face and get the same
// person's photos back, and nobody else's. Runs both models under Bun (in find-faces.ts's worker); the
// first run downloads them (about 10 MB, `bun run models`).
import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ensureModels } from "../scripts/models.ts";
import { SharedIndex } from "../src/engine/index.ts";
import { DIMS } from "../src/engine/layout.ts";
import { askFace, indexFaces, type Face } from "../src/faces/face.ts";

setDefaultTimeout(120_000);
const DIR = join(import.meta.dir, "..", "public", "faces");
const names = readdirSync(DIR).filter((f) => f.endsWith(".jpg")).sort();
let faces: Face[] = [];

beforeAll(async () => {
  const models = await ensureModels();
  const w = new Worker(new URL("./find-faces.ts", import.meta.url));
  faces = await new Promise<Face[]>((ok, no) => {
    w.onmessage = (e: MessageEvent<Face[]>) => ok(e.data);
    w.onerror = (e) => no(new Error(e.message));
    w.postMessage({ photos: names.map((n) => join(DIR, n)), models });
  });
  w.terminate();
});

const who = (f: Face) => names[f.page].replace(/\.jpg$/, "");
/** The pictures that come back for the face on `photo` (the rightmost one there). */
async function same(photo: string): Promise<string[]> {
  const tiles = 500; // the rows before the faces, as a page's tiles would be
  const index = await SharedIndex.create({ capacity: tiles + faces.length, scratch: DIMS * 4, wasm: null });
  index.used = tiles + faces.length;
  indexFaces(index, faces, tiles, index.layout.scratch);
  const mine = faces.filter((f) => who(f) === photo).sort((a, b) => b.box[0] - a.box[0])[0];
  const { matches } = await askFace(index, faces, tiles, faces.indexOf(mine));
  expect(matches.every((m) => m.row >= tiles)).toBe(true);
  return [...new Set(matches.map((m) => who(faces[m.face])))].sort();
}

test("finds one face on each portrait and all six on the crew photo", () => {
  const count = (photo: string) => faces.filter((f) => who(f) === photo).length;
  for (const p of ["koch-emu", "koch-artemis", "meir-emu", "meir-wb57", "whitson"]) expect(count(p)).toBe(1);
  expect(count("expedition-59")).toBe(6);
});

test("a face finds the same person across photos, and only them", async () => {
  // The crew photo's rightmost face is the same astronaut as the two koch portraits.
  expect(await same("expedition-59")).toEqual(["expedition-59", "koch-artemis", "koch-emu"]);
  expect(await same("meir-emu")).toEqual(["meir-emu", "meir-wb57"]);
  expect(await same("whitson")).toEqual(["whitson"]);
});
