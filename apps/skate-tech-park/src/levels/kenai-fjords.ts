// Kenai Fjords: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Exit Glacier Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const kenaiFjords = streetPark("kenai-fjords", {
  street: { x: -73, z: 17, yaw: 2.356 },
  sky: { x: 37, z: -33, yaw: 1.571 },
  bowl: { x: -13, z: 97 },
  gap: { at: { x: -218, z: 202, yaw: 0.7853981633974483 }, run: { x: -267, z: 153 }, land: { x: -182, z: 253 }, rb: 20, min: 39 },
  view: { x: -93, z: 77 },
}, { gap: "Exit Glacier Gap", blurb: "A street line in the gravel valley and a launch off the moraine toward the Harding Icefield." });
