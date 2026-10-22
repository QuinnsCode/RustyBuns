// Kobuk Valley: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Great Kobuk Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
// The ground is nearly level, so a gentler slope counts as a hillside and a cut still stands near a spawn (hillMin).
import { streetPark } from "./template.ts";

export const kobukValley = streetPark("kobuk-valley", {
  street: { x: 37, z: -73, yaw: 0 },
  sky: { x: -73, z: -53, yaw: 0 },
  bowl: { x: -13, z: 47 },
  gap: { at: { x: -138, z: 231, yaw: 5.497787143782138 }, run: { x: -89, z: 182 }, land: { x: -176, z: 279 }, rb: 21, min: 39 },
  view: { x: -33, z: -63 },
}, { earthworks: { hillMin: 0.09 }, gap: "Great Kobuk Drop", blurb: "A street line along the dune flats and a launch off a slip face toward the heart of the Great Kobuk Sand Dunes." });
