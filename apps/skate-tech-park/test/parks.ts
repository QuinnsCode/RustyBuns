// The levels the tests ride, built once per run: a park's ground is loaded on demand, so building is async,
// and seventy parks are slow enough to build once and share (no test changes a level).
import { LEVELS, type Entry } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";

const built = new Map<string, Promise<Awaited<ReturnType<Entry["load"]>>>>();

/** The level an entry builds, friendly height unless `real`. */
export const build = (e: Entry, real = false) => {
  const key = `${e.id}${real ? "?real" : ""}`;
  if (!built.has(key)) built.set(key, e.load(real));
  return built.get(key)!;
};

/** A level by id, built. */
export const level = (id: string, real = false) => build(LEVELS.find((e) => e.id === id)!, real);

/** Every park (not the plaza), built, in the picker's order. */
export const allParks = () => Promise.all(LEVELS.filter((e) => e.id !== "plaza").map((e) => build(e) as Promise<ParkLevel>));

/**
 * The parks the slow per-park journeys (a twenty second tour, every trick) ride: the eight drawn by hand and every fourth
 * surveyed one, so CI stays inside its ten minutes with seventy levels. `ALL_PARKS=1 bun test` rides them all, and
 * `bun scripts/check.ts src/levels/<id>.ts` runs the same checks on any one park.
 */
export const sample = (entries: Entry[]): Entry[] => {
  const parks = entries.filter((e) => e.id !== "plaza");
  if (process.env.ALL_PARKS) return parks;
  const handDrawn = new Set(["el-capitan", "glacier-point", "old-faithful", "mariposa-grove", "half-dome", "yosemite-falls", "grand-prismatic", "grand-canyon"]);
  const surveyed = parks.filter((e) => !handDrawn.has(e.id));
  return parks.filter((e) => handDrawn.has(e.id) || surveyed.indexOf(e) % 4 === 0);
};
