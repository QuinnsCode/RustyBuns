// Theodore Roosevelt: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Painted Canyon Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
// The ground is nearly level, so a gentler slope counts as a hillside and a cut still stands near a spawn (hillMin).
import { streetPark } from "./template.ts";

export const theodoreRoosevelt = streetPark("theodore-roosevelt", {
  street: { x: -53, z: -53, yaw: 0.785 },
  sky: { x: -23, z: -83, yaw: 0.785 },
  bowl: { x: -33, z: 37 },
  gap: { at: { x: 37, z: -156, yaw: 0 }, run: { x: 37, z: -226 }, land: { x: 44, z: -92 }, rb: 21, min: 41 },
  view: { x: -63, z: -3 },
}, { earthworks: { hillMin: 0.09 }, gap: "Painted Canyon Drop", blurb: "A street line across the badlands flat and a launch off a butte toward the Painted Canyon overlook." });
