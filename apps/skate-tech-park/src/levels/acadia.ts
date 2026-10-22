// Acadia: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Cadillac Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const acadia = streetPark("acadia", {
  street: { x: -63, z: 17, yaw: 1.571 },
  sky: { x: -103, z: -3, yaw: 2.356 },
  bowl: { x: -3, z: -33 },
  gap: { at: { x: 111, z: -43, yaw: 1.5707963267948966 }, run: { x: 41, z: -43 }, land: { x: 171, z: -31 }, rb: 25, min: 36 },
  view: { x: -13, z: 77 },
}, { gap: "Cadillac Leap", blurb: "Pink granite lines on the summit shelf of Cadillac Mountain, and a jump off the ledge toward Frenchman Bay." });
