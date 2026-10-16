// Every park is dotted with kit parts from edge to edge, the same way each time, and never on a spawn.
import { expect, test } from "bun:test";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";

const parks = LEVELS.filter((l) => l.id !== "plaza").map((l) => l.load() as ParkLevel);

test("each park has parts in most of its map, not one cluster", () => {
  for (const l of parks) {
    const b = l.bounds, cells = new Set(l.pieces.map((p) => `${Math.floor(((p.x - b.minX) / (b.maxX - b.minX)) * 4)},${Math.floor(((p.z - b.minZ) / (b.maxZ - b.minZ)) * 4)}`));
    expect(cells.size).toBeGreaterThanOrEqual(9);
  }
});

test("scatter is the same every load and leaves every spawn clear", () => {
  for (const [i, l] of parks.entries()) {
    const again = LEVELS.filter((e) => e.id !== "plaza")[i]!.load() as ParkLevel;
    expect(again.pieces.map((p) => [p.x, p.z])).toEqual(l.pieces.map((p) => [p.x, p.z]));
    for (const s of l.spawns) for (const p of l.pieces) expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeGreaterThan(5);
  }
});
