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
