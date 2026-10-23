// Glacier: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Logan Pass Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const glacier = streetPark("glacier", {
  street: { x: -73, z: -3, yaw: 1.571 },
  sky: { x: -133, z: -3, yaw: 0.785 },
  bowl: { x: -3, z: 47 },
  gap: { at: { x: 37, z: -103, yaw: 3.9269908169872414 }, run: { x: 86, z: -54 }, land: { x: 5, z: -166 }, rb: 25, min: 44 },
  view: { x: 37, z: 37 },
}, { gap: "Logan Pass Leap", blurb: "Skate the saddle at Logan Pass and launch off the cirque lip toward the Garden Wall." });
