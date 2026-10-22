// Mammoth Cave: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Sinkhole Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const mammothCave = streetPark("mammoth-cave", {
  street: { x: -3, z: -73, yaw: 0 },
  sky: { x: 47, z: 87, yaw: 0.785 },
  bowl: { x: -53, z: -43 },
  gap: { at: { x: -123, z: -82, yaw: 0 }, run: { x: -123, z: -152 }, land: { x: -106, z: -18 }, rb: 25, min: 40 },
  view: { x: -43, z: -83 },
}, { gap: "Sinkhole Drop", blurb: "A street line across the Kentucky ridgetop and a launch into the sinkhole toward the Historic Entrance." });
