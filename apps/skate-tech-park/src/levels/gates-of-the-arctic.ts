// Gates of the Arctic: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Frigid Crags Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const gatesOfTheArctic = streetPark("gates-of-the-arctic", {
  street: { x: -3, z: -153, yaw: 0.785 },
  sky: { x: -203, z: 147, yaw: 2.356 },
  bowl: { x: 117, z: 97 },
  gap: { at: { x: 40, z: 57, yaw: 4.71238898038469 }, run: { x: 110, z: 57 }, land: { x: -21, z: 39 }, rb: 23, min: 41 },
  view: { x: 157, z: 87 },
}, { gap: "Frigid Crags Gap", blurb: "A street line along the Koyukuk gravel bars and a launch off the river terrace toward the gate between Boreal Mountain and Frigid Crags." });
