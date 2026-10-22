// Olympic: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Ridge Hop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const olympic = streetPark("olympic", {
  street: { x: -43, z: -3, yaw: 1.571 },
  sky: { x: -183, z: -73, yaw: 0.785 },
  bowl: { x: 107, z: -53 },
  gap: { at: { x: 9, z: 105, yaw: 5.497787143782138 }, run: { x: 58, z: 56 }, land: { x: -45, z: 135 }, rb: 22, min: 39 },
  view: { x: 37, z: -43 },
}, { gap: "Ridge Hop", blurb: "Meadow lines along Hurricane Ridge and a launch off the edge toward Mount Olympus." });
