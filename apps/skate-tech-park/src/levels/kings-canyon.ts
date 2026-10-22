// Kings Canyon: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Zumwalt Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const kingsCanyon = streetPark("kings-canyon", {
  street: { x: -83, z: -3, yaw: 1.571 },
  sky: { x: -43, z: 37, yaw: 1.571 },
  bowl: { x: 7, z: -53 },
  gap: { at: { x: 133, z: -120, yaw: 5.497787143782138 }, run: { x: 182, z: -169 }, land: { x: 80, z: -84 }, rb: 22, min: 40 },
  view: { x: 47, z: -43 },
}, { gap: "Zumwalt Gap", blurb: "Roll the meadow under the granite walls and clear the drop toward the river." });
