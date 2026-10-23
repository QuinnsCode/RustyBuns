// Virgin Islands: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Trunk Bay Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const virginIslands = streetPark("virgin-islands", {
  street: { x: -93, z: -13, yaw: 1.571 },
  sky: { x: -133, z: -53, yaw: 1.571 },
  bowl: { x: -43, z: -103 },
  gap: { at: { x: -59, z: 201, yaw: 3.9269908169872414 }, run: { x: -10, z: 250 }, land: { x: -92, z: 143 }, rb: 23, min: 39 },
  view: { x: 7, z: -93 },
}, { gap: "Trunk Bay Drop", blurb: "A street line along the white sand of Trunk Bay and a launch off the green hill behind it toward the beach." });
