// New River Gorge: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Gorge Hop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const newRiverGorge = streetPark("new-river-gorge", {
  street: { x: -33, z: -43, yaw: 0.785 },
  sky: { x: -233, z: -3, yaw: 0.785 },
  bowl: { x: 97, z: 107 },
  gap: { at: { x: -22, z: 138, yaw: 0.7853981633974483 }, run: { x: -71, z: 89 }, land: { x: 10, z: 190 }, rb: 24, min: 39 },
  view: { x: 197, z: -73 },
}, { gap: "Gorge Hop", blurb: "A street line on the rim of the gorge and a jump over the ravine toward the old river." });
