// Guadalupe Mountains: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the El Capitan Ledge on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const guadalupeMountains = streetPark("guadalupe-mountains", {
  street: { x: -93, z: -63, yaw: 1.571 },
  sky: { x: -153, z: 7, yaw: 0.785 },
  bowl: { x: 27, z: 67 },
  gap: { at: { x: -17, z: -3, yaw: 4.71238898038469 }, run: { x: 53, z: -3 }, land: { x: -82, z: -15 }, rb: 25, min: 41 },
  view: { x: 7, z: -103 },
}, { gap: "El Capitan Ledge",blurb: "A street line across the reef's shoulder and a launch off the summit ridge toward the top of Texas." });
