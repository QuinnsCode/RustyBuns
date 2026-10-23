// Arches: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Delicate Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const arches = streetPark("arches", {
  street: { x: -183, z: 17, yaw: 1.571 },
  sky: { x: -113, z: -43, yaw: 2.356 },
  bowl: { x: 37, z: 87 },
  gap: { at: { x: 97, z: 30, yaw: 0 }, run: { x: 97, z: -40 }, land: { x: 85, z: 101 }, rb: 20, min: 46 },
  view: { x: -103, z: 57 },
}, { gap: "Delicate Gap", blurb: "Slickrock lines under the sun-baked bowl of Delicate Arch, and a launch off the sandstone ledge." });
