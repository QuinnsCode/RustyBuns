// Kings Canyon: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Zumwalt Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const kingsCanyon = streetPark("kings-canyon", {
  street: { x: -53, z: -53, yaw: 0.785 },
  sky: { x: -13, z: -73, yaw: 0.785 },
  bowl: { x: -33, z: 37 },
  gap: { at: { x: -8, z: 181, yaw: 2.356194490192345 }, run: { x: -57, z: 230 }, land: { x: 55, z: 142 }, rb: 27, min: 46 },
  view: { x: -63, z: -3 },
}, { gap: "Zumwalt Drop",blurb: "A street line across the meadow floor and a launch off the river terrace toward Zumwalt Meadow under the canyon walls." });
