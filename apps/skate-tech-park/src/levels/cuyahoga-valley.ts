// Cuyahoga Valley: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Brandywine Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const cuyahogaValley = streetPark("cuyahoga-valley", {
  street: { x: 31, z: -49, yaw: 0.785 },
  sky: { x: 10, z: -10, yaw: 3.142 },
  bowl: { x: 117, z: -43 },
  gap: { at: { x: 17, z: 100, yaw: 3.141592653589793 }, run: { x: 17, z: 170 }, land: { x: 22, z: 46 }, rb: 29, min: 36 },
  view: { x: 37, z: 147 },
}, { gap: "Brandywine Drop",blurb: "A street line along the valley floor and a launch over the wooded ledge toward Brandywine Falls." });
