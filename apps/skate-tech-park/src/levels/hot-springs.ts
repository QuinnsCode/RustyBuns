// Hot Springs: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Bathhouse Row Hop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const hotSprings = streetPark("hot-springs", {
  street: { x: 7, z: -73, yaw: 0 },
  sky: { x: -33, z: 117, yaw: 1.571 },
  bowl: { x: 17, z: 167 },
  gap: { at: { x: -95, z: -52, yaw: 2.356194490192345 }, run: { x: -144, z: -3 }, land: { x: -36, z: -81 }, rb: 26, min: 39 },
  view: { x: 67, z: 157 },
}, { gap: "Bathhouse Row Hop", blurb: "A street line down the valley floor and a hop off the Ouachita foothill toward Bathhouse Row." });
