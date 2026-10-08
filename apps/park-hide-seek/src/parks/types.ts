import type { Pt } from "../geo.ts";

export type LandmarkKind = "peak" | "falls" | "geyser" | "spring" | "arch" | "cave" | "view" | "start";

export interface Landmark { name: string; kind: LandmarkKind; x: number; y: number; ele?: number }

/** One park as committed in src/parks/data, in km around `center` (x east, y north). */
export interface ParkData {
  code: string;
  name: string;
  state: string;
  /** [lon, lat] of the projection origin. */
  center: [number, number];
  outline: Pt[][];
  lakes: { name: string; ring: Pt[]; area: number }[];
  rivers: { name: string; line: Pt[] }[];
  roads: { name: string; line: Pt[] }[];
  landmarks: Landmark[];
  /** Where the seeker starts each round. */
  start: Landmark;
}
