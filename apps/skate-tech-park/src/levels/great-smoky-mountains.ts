// Great Smoky Mountains: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Clingmans Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const greatSmokyMountains = streetPark("great-smoky-mountains", {
  street: { x: 87, z: -13, yaw: 0 },
  sky: { x: -183, z: 27, yaw: 1.571 },
  bowl: { x: 7, z: -23 },
  gap: { at: { x: -48, z: -239, yaw: 2.356194490192345 }, run: { x: -97, z: -190 }, land: { x: 0, z: -270 }, rb: 21, min: 37 },
  view: { x: 47, z: 57 },
}, { gap: "Clingmans Drop", blurb: "A line of ramps on the ridge in the haze, and a launch off the edge into the cove below." });
