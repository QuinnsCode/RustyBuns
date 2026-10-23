// Haleakala: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Crater Rim Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const haleakala = streetPark("haleakala", {
  street: { x: -173, z: -13, yaw: 2.356 },
  sky: { x: -173, z: -73, yaw: 2.356 },
  bowl: { x: -93, z: -3 },
  gap: { at: { x: 29, z: 164, yaw: 2.356194490192345 }, run: { x: -20, z: 213 }, land: { x: 80, z: 122 }, rb: 26, min: 42 },
  view: { x: -113, z: 107 },
}, { gap: "Crater Rim Leap", blurb: "Skate the cinder benches beside the crater and clear the first drop toward the cones." });
