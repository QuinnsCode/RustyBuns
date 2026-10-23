// Big Bend: laid out by scripts/survey.ts from the park's own ground (the street on the flat bench nearest the spot,
// the Santa Elena Leap on the lip of the drop it found), with a spawn on level ground facing the signature spot.
import { streetPark } from "./template.ts";

export const bigBend = streetPark("big-bend", {
  street: { x: -53, z: -53, yaw: 0.785 },
  sky: { x: -23, z: -83, yaw: 0.785 },
  bowl: { x: -33, z: 37 },
  gap: { at: { x: -248, z: -59, yaw: 2.356194490192345 }, run: { x: -297, z: -10 }, land: { x: -217, z: -123 }, rb: 26, min: 43 },
  view: { x: -3, z: 67 },
}, { gap: "Santa Elena Leap", blurb: "Skate the desert bench above the Rio Grande and leap the drop toward the mouth of Santa Elena Canyon." });
