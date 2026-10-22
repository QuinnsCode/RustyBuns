// Petrified Forest: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Blue Mesa Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const petrifiedForest = streetPark("petrified-forest", {
  street: { x: -43, z: -33, yaw: 0 },
  sky: { x: -83, z: -73, yaw: 0 },
  bowl: { x: 57, z: 7 },
  gap: { at: { x: 163, z: -123, yaw: 4.71238898038469 }, run: { x: 233, z: -123 }, land: { x: 102, z: -132 }, rb: 22, min: 40 },
  view: { x: 37, z: 47 },
}, { gap: "Blue Mesa Drop",blurb: "A street line across the mesa top and a launch off a clay rim toward the striped badlands and their quartz logs." });
