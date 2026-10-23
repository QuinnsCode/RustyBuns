// North Cascades: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Diablo Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const northCascades = streetPark("north-cascades", {
  street: { x: 17, z: -53, yaw: 0.785 },
  sky: { x: 47, z: -83, yaw: 0.785 },
  bowl: { x: 107, z: -93 },
  gap: { at: { x: -16, z: 89, yaw: 2.356194490192345 }, run: { x: -65, z: 138 }, land: { x: 37, z: 57 }, rb: 24, min: 40 },
  view: { x: 137, z: -53 },
}, { gap: "Diablo Leap", blurb: "A street line along the lakeshore flat and a launch off the bank toward the turquoise water of Diablo Lake." });
