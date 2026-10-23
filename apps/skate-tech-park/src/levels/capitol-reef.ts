// Capitol Reef: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Waterpocket Hop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const capitolReef = streetPark("capitol-reef", {
  street: { x: -33, z: -73, yaw: 0 },
  sky: { x: -93, z: -23, yaw: 0 },
  bowl: { x: -3, z: -113 },
  gap: { at: { x: 68, z: 128, yaw: 3.9269908169872414 }, run: { x: 117, z: 177 }, land: { x: 12, z: 89 }, rb: 26, min: 45 },
  view: { x: 27, z: -143 },
}, { gap: "Waterpocket Hop", blurb: "Roll the benches under the Waterpocket Fold and jump the wash." });
