import { record } from "@rustybuns/util";
import { expect, test } from "bun:test";
import { GROUND_BIOMES, groundWeights, heaveOf, LAYERS, LAYER_COUNT, moundNoise, type Cover } from "../src/world/ground.ts";
import { decodeNormals } from "../src/arena.ts";

const none: Cover = { litter: 0, grass: 0, sand: 0, mud: 0, path: 0, rock: 0, snow: 0 };
const at = (biome: Parameters<typeof groundWeights>[0], c: Partial<Cover> = {}) => {
  const w = new Float32Array(LAYER_COUNT);
  groundWeights(biome, { ...none, ...c }, w);
  return record(LAYERS, (_, i) => w[i]!);
};

test("every vertex's layer weights sum to one, wherever it is and whatever lies over it", () => {
  for (const biome of GROUND_BIOMES) for (const c of [none, { grass: 0.6, sand: 0.3 }, { mud: 1, path: 0.5, rock: 0.8, snow: 1 }, { litter: 0.7, grass: 0.3 }]) {
    const w = at(biome, c);
    expect(Object.values(w).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 5);
  }
});

test("the biome sets the bare ground, and what lies over it takes its share", () => {
  expect(at("desert").sand).toBeGreaterThan(0.6);
  expect(at("pine-barrens").needles).toBeGreaterThan(at("pine-barrens").dirt);
  expect(at("swamp").mud).toBeGreaterThan(0.5);
  expect(at("forest", { snow: 1 }).snow).toBeCloseTo(1, 5);
  expect(at("desert", { path: 1 }).dirt).toBeCloseTo(1, 5);
  expect(at("forest", { grass: 0.5 }).turf).toBeCloseTo(0.5, 5);
});

test("a baked normal map decodes to a tangent-space one: level ground points straight up, a lean keeps its length one", () => {
  const d = new Uint8ClampedArray([128, 128, 77, 255, 218, 128, 0, 255]);
  decodeNormals(d);
  expect(d[2]).toBe(255);
  const nx = 218 / 127.5 - 1, nz = d[6]! / 127.5 - 1;
  expect(Math.hypot(nx, nz)).toBeCloseTo(1, 1);
});

test("the floor round your feet heaves in smooth mounds, most where a litter floor lies over roots, least on sand and snow", () => {
  // smooth: across a 40 m patch, no two points a centimetre apart differ by more than a hair, and the mounds span the range
  let lo = 1, hi = 0, step = 0;
  for (let x = 0; x < 40; x += 0.37) for (let z = 0; z < 40; z += 0.41) {
    const h = moundNoise(x * 0.55, z * 0.55);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
    step = Math.max(step, Math.abs(moundNoise((x + 0.01) * 0.55, z * 0.55) - h), Math.abs(moundNoise(x * 0.55, (z + 0.01) * 0.55) - h));
  }
  expect([lo < 0.15, hi > 0.85, step < 0.02]).toEqual([true, true, true]);
  const heave = (biome: Parameters<typeof groundWeights>[0], c: Partial<Cover> = {}) => { const w = new Float32Array(LAYER_COUNT); groundWeights(biome, { ...none, ...c }, w); return heaveOf(w); };
  const forest = heave("forest", { litter: 0.8 });
  expect([forest > heave("desert"), forest > heave("forest", { snow: 1 })]).toEqual([true, true]);
});
