// Indiana Dunes: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Mount Baldy Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const indianaDunes = streetPark("indiana-dunes", {
  street: { x: -53, z: -53, yaw: 0.785 },
  sky: { x: -63, z: -3, yaw: 0.785 },
  bowl: { x: 37, z: -33 },
  gap: { at: { x: -64, z: -164, yaw: 3.9269908169872414 }, run: { x: -15, z: -115 }, land: { x: -105, z: -212 }, rb: 23, min: 39 },
  view: { x: 67, z: -3 },
}, { gap: "Mount Baldy Drop", blurb: "A street line along the beach flats and a launch off the dune's slip face toward Mount Baldy's crest." });
