import { expect, test } from "bun:test";
import { blend, DIM, nearest } from "./steer-vec.ts";

// Three unit vectors along the first three axes, and a query between the first two, nearer the second.
const vecs = new Float32Array(3 * DIM);
[0, 1, 2].forEach((i) => { vecs[i * DIM + i] = 1; });
const q = new Float32Array(DIM);
q[0] = 0.6; q[1] = 0.8;

test.each<[string, () => unknown, unknown]>([
  ["the scan ranks rows by cosine, best first", () => nearest(vecs, q, 2).map((h) => h.doc), [1, 0]],
  ["a row both halves found beats one only words found",
    () => blend([{ doc: 7, score: 9 }, { doc: 3, score: 5 }, { doc: 4, score: 1 }], [{ doc: 3, score: 0.9 }, { doc: 8, score: 0.2 }], 0.5)[0]?.doc, 3],
  ["weight 0 is BM25's order", () => blend([{ doc: 7, score: 9 }, { doc: 3, score: 5 }], [{ doc: 3, score: 0.9 }, { doc: 7, score: 0.1 }], 0).map((h) => h.doc), [7, 3]],
])("%s", (_, run, want) => {
  expect(run()).toEqual(want);
});
