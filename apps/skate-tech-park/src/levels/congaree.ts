// Congaree: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Cedar Creek Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const congaree = streetPark("congaree", {
  street: { x: -53, z: -53, yaw: 0.785 },
  sky: { x: -83, z: -23, yaw: 0.785 },
  bowl: { x: 37, z: -33 },
  gap: { at: { x: -183, z: 126, yaw: 0 }, run: { x: -183, z: 56 }, land: { x: -181, z: 190 }, rb: 25, min: 41 },
  view: { x: -3, z: -73 },
}, { gap: "Cedar Creek Drop", blurb: "A street line through the floodplain forest and a launch off the bank toward Cedar Creek." });
