// Dry Tortugas: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Fort Jefferson Hop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
// The ground is nearly level, so a gentler slope counts as a hillside and a cut still stands near a spawn (hillMin).
import { streetPark } from "./template.ts";

export const dryTortugas = streetPark("dry-tortugas", {
  street: { x: -83, z: -73, yaw: 0 },
  sky: { x: 27, z: 147, yaw: 2.356 },
  bowl: { x: -133, z: -3 },
  gap: { at: { x: 222, z: 11, yaw: 2.356194490192345 }, run: { x: 173, z: 60 }, land: { x: 266, z: -37 }, rb: 21, min: 41 },
  view: { x: -123, z: 37 },
}, { earthworks: { hillMin: 0.09 }, gap: "Fort Jefferson Hop", blurb: "A street line along the fort's moat wall and a launch off the key's edge toward Fort Jefferson's brick casemates." });
