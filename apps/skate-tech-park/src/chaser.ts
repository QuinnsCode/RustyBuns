// An animal that chases the rider (?chase=moose|bear|bigfoot). It runs straight at the board at a share of the
// jets' top speed: faster than a push can go, so standing still or rolling slow costs you, slower than the jets,
// so a run is "outrun it". It follows the ground and ignores kit and trees, and a bail while it is close ends the run.
import { JETS, type State } from "./sim.ts";
import type { Bounds } from "./level.ts";

export const SPECIES = ["moose", "bear", "bigfoot"] as const;
export type Species = (typeof SPECIES)[number];

/** The tuning knob: its speed as a share of the rider's boosted top speed. */
export const PACE = { moose: 0.7, bear: 0.75, bigfoot: 0.8 } as const satisfies Record<Species, number>;
export const HEAD_START = 45; // metres behind the rider at the start of a run
export const GRACE = 3; // seconds it stands and watches before it charges
export const CATCH = 3; // metres: this close and it has you, bailed or not
export const CLOSE = 14; // metres: a bail inside this ends the run

export type Chaser = { species: Species; x: number; y: number; z: number; yaw: number; speed: number; t: number; caught: boolean };

/** `?chase=` from a query string, or null for none. */
export const chaseOf = (search: string): Species | null => {
  const v = new URLSearchParams(search).get("chase");
  return SPECIES.find((s) => s === v) ?? null;
};

export function release(species: Species, rider: Pick<State, "x" | "z" | "yaw">, height: (x: number, z: number) => number, bounds: Bounds): Chaser {
  const x = Math.min(bounds.maxX, Math.max(bounds.minX, rider.x - Math.sin(rider.yaw) * HEAD_START));
  const z = Math.min(bounds.maxZ, Math.max(bounds.minZ, rider.z - Math.cos(rider.yaw) * HEAD_START));
  return { species, x, y: height(x, z), z, yaw: rider.yaw, speed: 0, t: 0, caught: false };
}

export const gap = (c: Pick<Chaser, "x" | "z">, r: Pick<State, "x" | "z">) => Math.hypot(r.x - c.x, r.z - c.z);

/** One step of `dt` seconds. Sets `caught` once it has the rider; after that it stops. */
export function chase(c: Chaser, rider: Pick<State, "x" | "z" | "bail">, height: (x: number, z: number) => number, bounds: Bounds, dt: number): Chaser {
  c.t += dt;
  const d = gap(c, rider);
  if (c.caught) { c.speed = 0; return c; }
  if (d < CATCH || (rider.bail > 0 && d < CLOSE)) { c.caught = true; c.speed = 0; return c; }
  if (c.t < GRACE) return c;
  c.yaw = Math.atan2(rider.x - c.x, rider.z - c.z);
  c.speed = PACE[c.species] * JETS.boostTop;
  const run = Math.min(c.speed * dt, d);
  c.x = Math.min(bounds.maxX, Math.max(bounds.minX, c.x + Math.sin(c.yaw) * run));
  c.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, c.z + Math.cos(c.yaw) * run));
  c.y = height(c.x, c.z);
  return c;
}
