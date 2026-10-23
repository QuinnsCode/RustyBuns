// Redwood: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Fern Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const redwood = streetPark("redwood", {
  street: { x: 117, z: -63, yaw: 0 },
  sky: { x: -23, z: -243, yaw: 0 },
  bowl: { x: 37, z: -103 },
  gap: { at: { x: 205, z: 237, yaw: 1.5707963267948966 }, run: { x: 135, z: 237 }, land: { x: 263, z: 243 }, rb: 19, min: 38 },
  view: { x: 17, z: -143 },
}, { gap: "Fern Gap", blurb: "A street line in a hollow among the tallest trees on Earth, and a jump over the ravine." });
