import { expect, test } from "bun:test";
import { GROUND_BIOMES, groundWeights, LAYERS, LAYER_COUNT, type Cover } from "../src/world/ground.ts";

const none: Cover = { grass: 0, sand: 0, mud: 0, path: 0, rock: 0, snow: 0 };
const at = (biome: Parameters<typeof groundWeights>[0], c: Partial<Cover> = {}) => {
  const w = new Float32Array(LAYER_COUNT);
  groundWeights(biome, { ...none, ...c }, w);
  return Object.fromEntries(LAYERS.map((n, i) => [n, w[i]!])) as Record<(typeof LAYERS)[number], number>;
};

test("every vertex's layer weights sum to one, wherever it is and whatever lies over it", () => {
  for (const biome of GROUND_BIOMES) for (const c of [none, { grass: 0.6, sand: 0.3 }, { mud: 1, path: 0.5, rock: 0.8, snow: 1 }]) {
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
