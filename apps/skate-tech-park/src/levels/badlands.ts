// Badlands: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Gully Gap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const badlands = streetPark("badlands", {
  street: { x: -3, z: -103, yaw: 0.785 },
  sky: { x: 47, z: -143, yaw: 0.785 },
  bowl: { x: 7, z: 37 },
  gap: { at: { x: -219, z: 221, yaw: 3.9269908169872414 }, run: { x: -170, z: 270 }, land: { x: -255, z: 176 }, rb: 18, min: 37 },
  view: { x: -63, z: 97 },
}, { gap: "Gully Gap", blurb: "Run the prairie flats between the striped ridges and clear a badlands gully." });
