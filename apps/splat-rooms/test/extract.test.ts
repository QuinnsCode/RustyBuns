// #3269 spike: a labelled scan cut into objects, and PLYs whose header leaves the tables unaligned.
import { expect, test } from "bun:test";
import { mulberry32 } from "@rustybuns/util";
import type { Corner, SceneObject } from "../src/actions/scenes.ts";
import { candidates } from "../src/game/round.ts";
import { decimatePly } from "../src/viewer/decimate.ts";
import { cutObjects, iou, roughen, toRows } from "../rooms/extract.ts";
import { packPly, ROW } from "../rooms/pack.ts";
import { readPly } from "../../splat-spray/src/levels/ply.ts";

const box = (x: number, y: number, z: number, w: number, d: number, h: number): Corner[] => {
  const b = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
  return [...b.map(([px, py]) => ({ x: px!, y: py!, z })), ...b.map(([px, py]) => ({ x: px!, y: py!, z: z + h }))];
};

/** n splats spread through [lo, hi] on every axis. */
function cloud(n: number, lo: number[], hi: number[], rand: () => number): number[][] {
  return Array.from({ length: n }, () => [0, 1, 2].map((a) => lo[a]! + rand() * (hi[a]! - lo[a]!)));
}

function ply(points: number[][]): Uint8Array {
  const rows = new Float32Array(points.length * ROW);
  points.forEach((p, i) => rows.set([p[0]!, p[1]!, p[2]!, 0.01, 0.01, 0.01, 1, 0, 0, 0, 0.5, 0.5, 0.5, 0.9], i * ROW));
  return packPly(rows);
}

test("a mug on a table is cut as the mug, and its piece decodes on its own", () => {
  const rand = mulberry32(3);
  const objects: SceneObject[] = [
    { ins_id: "t", label: "table", bounding_box: box(0, 0, 0, 1.2, 0.8, 0.75) },
    { ins_id: "m", label: "mug", bounding_box: box(0.5, 0.3, 0.75, 0.1, 0.1, 0.12) },
  ];
  const mug = cloud(300, [0.52, 0.32, 0.77], [0.58, 0.38, 0.85], rand);
  const table = cloud(2000, [0.02, 0.02, 0.02], [1.18, 0.78, 0.7], rand);
  const room = cloud(1000, [2, 2, 0], [4, 4, 2.5], rand);
  const raw = readPly(ply([...mug, ...table, ...room]))!;
  const cuts = cutObjects(raw, candidates(objects));
  expect(cuts.get("m")!.length).toBe(300);
  expect(cuts.get("t")!.length).toBe(2000);
  const piece = readPly(packPly(toRows(raw, cuts.get("m")!)));
  expect(piece?.count).toBe(300);

  // boxes moved and resized a little still find most of the mug; dropped boxes are gone
  const rough = roughen(objects, { shift: 0.01, scale: 0.05, drop: 0 }, mulberry32(1));
  const again = cutObjects(raw, candidates(rough));
  expect(iou(cuts.get("m")!, again.get("m")!)).toBeGreaterThan(0.6);
  expect(roughen(objects, { shift: 0, scale: 0, drop: 1 }, mulberry32(1))).toEqual([]);
});

test("a header that leaves the tables unaligned still decodes and thins", () => {
  const rand = mulberry32(9);
  const good = ply(cloud(1500, [0, 0, 0], [3, 3, 2], rand));
  // one more byte in the comment shifts every table off a 4-byte boundary
  const text = new TextDecoder().decode(good.subarray(0, 600));
  const at = text.indexOf("pack.ts") + "pack.ts".length;
  const bad = new Uint8Array(good.length + 1);
  bad.set(good.subarray(0, at));
  bad[at] = 0x20;
  bad.set(good.subarray(at), at + 1);
  expect(readPly(bad)?.count).toBe(1500);
  expect(readPly(decimatePly(bad as Uint8Array<ArrayBuffer>, 600))?.count).toBe(600);
});
