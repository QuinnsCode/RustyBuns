// What a studio is, as data: a room (size, floor and walls), the walls inside it, and the spots you sit at to play.
// Each room is one file in ./rooms; the jam room (./jam.ts) walks it and the page (./main.ts) builds it in three.js.

/** What a spot is for: what stands in front of the seat and how your keys play there. */
export type SpotKind = "keys" | "drums" | "bass" | "desk" | "vocal" | "couch";

/**
 * A place to sit and play. `at` is the seat (x, z metres from the middle of the room), `yaw` the way you face once
 * sat (0 faces -z). `track` is the FM DAW track your keys play from here; a drum spot's `kit` is a track per key
 * instead (the home row from A). A spot with neither (the couch, the desk) is just a seat.
 */
export interface Spot { id: string; name: string; kind: SpotKind; at: [number, number]; yaw: number; track?: number; kit?: number[] }

/** A wall inside the room, from one floor point to another. `glass` runs a window along it from `sill` up to `head`. */
export interface Partition { from: [number, number]; to: [number, number]; glass?: { sill: number; head: number } }

export interface StudioDef {
  id: string;
  name: string;
  /** Width (x) and depth (z) in metres, centred on the origin, and the ceiling's height. */
  size: [number, number];
  height: number;
  floor: number;
  walls: number;
  partitions: Partition[];
  spots: Spot[];
  /** Where you walk in, and which way you face. */
  door: { at: [number, number]; yaw: number };
}

/** How thick an inside wall is, metres. */
export const PARTITION_T = 0.12;
