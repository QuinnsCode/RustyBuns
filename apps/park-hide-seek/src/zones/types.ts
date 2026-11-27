import { arr, int, num, obj, oneOf, opt, str, type Guard, type Of } from "@rustybuns/util/guard";
import type { Landmark } from "../parks/types.ts";

const KINDS = ["peak", "falls", "geyser", "spring", "arch", "cave", "view", "start"] as const;
const metres = num(-1e7, 1e7);
/** [x, y] or [lon, lat]: JSON writes a pair as a plain list. */
const pair: Guard<[number, number]> = (v) => {
  const [a, b] = arr(metres, 2, { min: 2 })(v);
  return [a, b];
};
const landmark: Guard<Landmark> = obj({ name: str(200), kind: oneOf(KINDS), x: metres, y: metres, ele: opt(metres) });

/**
 * One drop zone as committed in packages/terrain/src/zones: real terrain round an attraction.
 * The guard reads a zone file (bundled or fetched) into this shape, and says which field is wrong.
 */
export const ZoneData = obj({
  id: str(100),
  /** Park code, e.g. "YOSE". */
  park: str(10),
  name: str(200),
  blurb: str(1000),
  /** What grows tallest: pines, giant sequoias, or saguaros with little cacti between them. */
  trees: oneOf(["pine", "sequoia", "desert"]),
  /** [lon, lat] of the zone centre. */
  center: pair,
  /** The zone centre in the park map's km coordinates, for the 2D drop map. */
  parkXY: pair,
  /** Half-width on the real ground, metres. */
  realRadius: num(1, 1e6),
  /** Samples per side. */
  n: int(2, 4096),
  /** n*n little-endian Int16 metres above sea level, base64; row 0 is the south edge. */
  heights: str(Infinity),
  /** In real metres from the centre, x east, y north. */
  landmarks: arr(landmark, 1000),
});
export type ZoneData = Of<typeof ZoneData>;
