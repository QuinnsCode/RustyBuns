// Canyonlands: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Mesa Arch Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const canyonlands = streetPark("canyonlands", {
  street: { x: -53, z: 57, yaw: 2.356 },
  sky: { x: -83, z: 27, yaw: 2.356 },
  bowl: { x: 37, z: 37 },
  gap: { at: { x: 96, z: 97, yaw: 1.5707963267948966 }, run: { x: 26, z: 97 }, land: { x: 165, z: 89 }, rb: 29, min: 43 },
  view: { x: 67, z: -3 },
}, { gap: "Mesa Arch Gap", blurb: "Slickrock street lines on the Island in the Sky, and a launch off a ledge toward the canyon." });
