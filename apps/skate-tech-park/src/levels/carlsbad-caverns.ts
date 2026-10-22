// Carlsbad Caverns: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Sinkhole Jump on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const carlsbadCaverns = streetPark("carlsbad-caverns", {
  street: { x: -73, z: -3, yaw: 1.571 },
  sky: { x: -63, z: -43, yaw: 1.571 },
  bowl: { x: -13, z: 47 },
  gap: { at: { x: -148, z: -128, yaw: 3.9269908169872414 }, run: { x: -99, z: -79 }, land: { x: -194, z: -162 }, rb: 19, min: 37 },
  view: { x: 27, z: 57 },
}, { gap: "Sinkhole Jump", blurb: "A street line on the Chihuahuan ridge above the cave, and a jump off the ledge toward the entrance." });
