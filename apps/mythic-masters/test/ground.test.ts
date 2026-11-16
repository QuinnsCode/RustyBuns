import { expect, test } from "bun:test";
import { GROUND_BIOMES, groundWeights, LAYERS, LAYER_COUNT, type Cover } from "../src/world/ground.ts";
import { decodeNormals } from "../src/arena.ts";

const none: Cover = { litter: 0, grass: 0, sand: 0, mud: 0, path: 0, rock: 0, snow: 0 };
const at = (biome: Parameters<typeof groundWeights>[0], c: Partial<Cover> = {}) => {
  const w = new Float32Array(LAYER_COUNT);
  groundWeights(biome, { ...none, ...c }, w);
  return Object.fromEntries(LAYERS.map((n, i) => [n, w[i]!])) as Record<(typeof LAYERS)[number], number>;
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
