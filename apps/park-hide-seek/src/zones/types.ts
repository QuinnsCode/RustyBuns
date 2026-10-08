import type { Landmark } from "../parks/types.ts";

/** One drop zone as committed in src/zones/data: real terrain round an attraction. */
export interface ZoneData {
  id: string;
  /** Park code, e.g. "YOSE". */
  park: string;
  name: string;
  blurb: string;
  trees: "pine" | "sequoia";
  /** [lon, lat] of the zone centre. */
  center: [number, number];
  /** The zone centre in the park map's km coordinates, for the 2D drop map. */
  parkXY: [number, number];
  /** Half-width on the real ground, metres. */
  realRadius: number;
  /** Samples per side. */
  n: number;
  /** n*n little-endian Int16 metres above sea level, base64; row 0 is the south edge. */
  heights: string;
  /** In real metres from the centre, x east, y north. */
  landmarks: Landmark[];
}
