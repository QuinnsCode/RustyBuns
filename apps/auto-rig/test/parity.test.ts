import { describe, expect, test } from "bun:test";
import { analyze, type RigResult } from "../src/rig/analyze.ts";
import { analyzeNative } from "../src/rig/native.ts";
import { gingerbread, lizard, GINGERBREAD_TIPS, LIZARD_TIPS, type Mesh } from "../src/rig/samples.ts";

const models: [string, () => Mesh, number[][]][] = [
  ["gingerbread", gingerbread, GINGERBREAD_TIPS],
  ["lizard", lizard, LIZARD_TIPS],
];

function tips(r: RigResult): number[][] {
  const J = r.parents.length;
  const out: number[][] = [];
  for (let j = 0; j < J; j++) if (!r.parents.includes(j)) out.push([...r.joints.slice(j * 3, j * 3 + 3)]);
  return out;
}

describe.each(models)("%s", (_name, make, expected) => {
  const m = make();
  const r = analyze(m.positions, m.indices);

  test("one tip per limb, each near where the limb ends", () => {
    const got = tips(r);
    expect(got.length).toBe(expected.length);
    for (const e of expected) {
      const d = Math.min(...got.map((g) => Math.hypot(g[0] - e[0], g[1] - e[1], g[2] - e[2])));
      expect(d).toBeLessThan(0.15);
    }
  });

  test("a tree: every joint's parent comes before it", () => {
    expect(r.parents[0]).toBe(-1);
    for (let j = 1; j < r.parents.length; j++) {
      expect(r.parents[j]).toBeGreaterThanOrEqual(0);
      expect(r.parents[j]).toBeLessThan(j);
    }
  });

  test("weights: four per vertex, summing to 1, on real bones", () => {
    const V = m.positions.length / 3;
    const bones = new Set(r.parents);
    for (let v = 0; v < V; v++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        const w = r.skinWeight[v * 4 + k];
        expect(Number.isFinite(w)).toBe(true);
        if (w > 0) expect(bones.has(r.skinIndex[v * 4 + k])).toBe(true);
        s += w;
      }
      expect(Math.abs(s - 1)).toBeLessThan(1e-5);
    }
  });

  test("Rust gives the same rig", async () => {
    const n = await analyzeNative(m.positions, m.indices);
    if (!n) { console.log("  (skipped: no native build; run `bun run build:native`)"); return; }
    expect([...n.parents]).toEqual([...r.parents]);
    expect([...n.joints]).toEqual([...r.joints]);
    expect([...n.skinIndex]).toEqual([...r.skinIndex]);
    let max = 0;
    for (let i = 0; i < r.skinWeight.length; i++) max = Math.max(max, Math.abs(n.skinWeight[i] - r.skinWeight[i]));
    console.log(`  max |rust - ts| weight = ${max.toExponential(2)}`);
    expect(max).toBeLessThan(1e-6);
  });
});

test("a mesh with no triangles is refused", () => {
  expect(() => analyze(new Float32Array(3), new Uint32Array(0))).toThrow();
});
