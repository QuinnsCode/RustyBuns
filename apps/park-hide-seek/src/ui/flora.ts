// The park's plants, grown from seeds by @rustybuns/models: a handful of each kind, built once per page and
// drawn as instanced meshes, each copy turned, sized and tinted by the zone.
import type * as THREE from "three";
import { barrel, pear, saguaro, shrub } from "@rustybuns/models";
import { hashString } from "../geo.ts";

export type Plants = Record<"bush" | "saguaro" | "cactus", THREE.BufferGeometry[]>;
let grown: Plants | null = null;

/** Six bushes (round, wide and low, berried), four saguaros, and barrel cacti and prickly pear. */
export const plants = (): Plants => grown ??= {
  bush: Array.from({ length: 6 }, (_, i) => shrub(101 + i, { wide: i % 3 === 1 ? 1.25 : 1, berries: i % 3 === 2 })),
  saguaro: [1, 2, 3, 4].map((s) => saguaro(s)),
  cactus: [barrel(1), pear(2), barrel(3), pear(4)],
};

/** Which of `n` grows at (x, y): fixed by where it stands, so every player sees the same one. */
export const variant = (n: number, x: number, y: number): number => hashString(`${x.toFixed(2)},${y.toFixed(2)}`) % n;
