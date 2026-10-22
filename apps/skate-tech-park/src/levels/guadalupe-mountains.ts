// Guadalupe Mountains: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Reef Edge Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const guadalupeMountains = streetPark("guadalupe-mountains", {
  street: { x: -163, z: 17, yaw: 0.785 },
  sky: { x: -143, z: -173, yaw: 0.785 },
  bowl: { x: 87, z: 127 },
  gap: { at: { x: 3, z: 57, yaw: 4.71238898038469 }, run: { x: 73, z: 57 }, land: { x: -69, z: 43 }, rb: 26, min: 48 },
  view: { x: 57, z: 157 },
}, { gap: "Reef Edge Leap", blurb: "Run the rim of the fossil reef above the salt flats and launch off the escarpment." });
