// Great Basin: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Bristlecone Jump on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const greatBasin = streetPark("great-basin", {
  street: { x: 17, z: 227, yaw: 2.356 },
  sky: { x: 67, z: 237, yaw: 2.356 },
  bowl: { x: -73, z: 167 },
  gap: { at: { x: 52, z: -188, yaw: 0.7853981633974483 }, run: { x: 3, z: -237 }, land: { x: 100, z: -153 }, rb: 24, min: 38 },
  view: { x: -163, z: 167 },
}, { gap: "Bristlecone Jump", blurb: "Skate a ridge of ancient pines under Wheeler Peak and jump the cirque lip." });
