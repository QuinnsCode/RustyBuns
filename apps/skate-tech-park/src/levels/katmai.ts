// Katmai: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Brooks Falls Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const katmai = streetPark("katmai", {
  street: { x: -53, z: 57, yaw: 2.356 },
  sky: { x: -83, z: 27, yaw: 2.356 },
  bowl: { x: 37, z: 37 },
  gap: { at: { x: 169, z: -103, yaw: 4.71238898038469 }, run: { x: 239, z: -103 }, land: { x: 108, z: -109 }, rb: 22, min: 39 },
  view: { x: -3, z: 67 },
}, { gap: "Brooks Falls Leap", blurb: "A street line along the Brooks River flats and a launch off the bank toward the lip of Brooks Falls where the bears stand." });
