// Lassen Volcanic: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Bumpass Hop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const lassenVolcanic = streetPark("lassen-volcanic", {
  street: { x: -13, z: 27, yaw: 2.356 },
  sky: { x: 7, z: 67, yaw: 2.356 },
  bowl: { x: -53, z: -113 },
  gap: { at: { x: -103, z: -63, yaw: 4.71238898038469 }, run: { x: -33, z: -63 }, land: { x: -165, z: -42 }, rb: 24, min: 40 },
  view: { x: -123, z: 27 },
}, { gap: "Bumpass Hop", blurb: "Skate the cinder flats of an old volcano and jump the ravine toward the steaming vents." });
