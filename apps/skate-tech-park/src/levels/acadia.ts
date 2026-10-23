// Acadia: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Cadillac Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const acadia = streetPark("acadia", {
  street: { x: 7, z: -43, yaw: 0 },
  sky: { x: -103, z: 7, yaw: 2.356 },
  bowl: { x: 57, z: -3 },
  gap: { at: { x: 157, z: -27, yaw: 0 }, run: { x: 157, z: -97 }, land: { x: 143, z: 28 }, rb: 22, min: 37 },
  view: { x: -53, z: 17 },
}, { gap: "Cadillac Leap", blurb: "Pink granite lines on the summit shelf of Cadillac Mountain, and a jump off the ledge toward Frenchman Bay." });
