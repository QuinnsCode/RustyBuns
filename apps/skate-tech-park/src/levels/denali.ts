// Denali: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Wonder Lake Drop on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const denali = streetPark("denali", {
  street: { x: -13, z: 97, yaw: 2.356 },
  sky: { x: -13, z: -63, yaw: 1.571 },
  bowl: { x: 77, z: 77 },
  gap: { at: { x: -141, z: -45, yaw: 2.356194490192345 }, run: { x: -190, z: 4 }, land: { x: -87, z: -86 }, rb: 24, min: 42 },
  view: { x: -43, z: -93 },
}, { gap: "Wonder Lake Drop", blurb: "A street line over the tundra flats and a launch off the moraine toward Wonder Lake with the mountain filling the sky." });
